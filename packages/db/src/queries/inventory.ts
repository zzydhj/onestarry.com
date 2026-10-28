import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { inventory, orders, stockMovements } from "../schema";
import type { Db, Tx } from "../client";

export interface StockRow {
    variantId: string;
    onHand: number;
    reserved: number;
    available: number;
}

/** 取某变体库存（无行视为全 0）。available 来自 DB 生成列，非应用层计算。 */
export async function getStock(db: Db | Tx, variantId: string): Promise<StockRow> {
    const row = (await db.select().from(inventory).where(eq(inventory.variantId, variantId)).limit(1))[0];
    return row
        ? { variantId: row.variantId, onHand: row.onHand, reserved: row.reserved, available: row.available ?? 0 }
        : { variantId, onHand: 0, reserved: 0, available: 0 };
}

export interface SetOnHandInput {
    variantId: string;
    onHand: number; // 绝对值（目标库存）
    note?: string | null;
    changedBy?: string | null;
}

/**
 * 手动设置某变体 on_hand（绝对值）：upsert inventory + 追加一条 adjustment 库存流水（带符号增量）。
 * available 为 DB 生成列自动跟随；可售性读时现算，故无需发事件。
 *
 * ⚠ 并发（审查 M-4）：整段“读旧值→算 delta→写绝对值”必须在事务内、且对 inventory 行 SELECT ... FOR UPDATE。
 *   否则两个并发 setVariantOnHand（或与 receiveStock 交错）各自从旧值算 delta，实际只涨一次却
 *   往 stock_movements 记了两笔 adjustment → 审计流水虚增（与 receiveStock 的原子写法同口径）。
 *   传入已是 Tx 时 transaction() 走 savepoint，FOR UPDATE 的锁仍持续到最外层事务提交。
 */
export async function setVariantOnHand(db: Db | Tx, input: SetOnHandInput): Promise<{ delta: number }> {
    return db.transaction(async (tx) => {
        const current = (
            await tx.select().from(inventory).where(eq(inventory.variantId, input.variantId)).limit(1).for("update")
        )[0];
        const oldOnHand = current?.onHand ?? 0;
        const delta = input.onHand - oldOnHand;

        await tx
            .insert(inventory)
            .values({ variantId: input.variantId, onHand: input.onHand, reserved: current?.reserved ?? 0 })
            .onConflictDoUpdate({ target: inventory.variantId, set: { onHand: input.onHand, updatedAt: new Date() } });

        if (delta !== 0) {
            await tx.insert(stockMovements).values({
                variantId: input.variantId,
                type: "adjustment",
                quantity: delta,
                onHandAfter: input.onHand,
                referenceType: "adjustment",
                note: input.note ?? (input.changedBy ? `manual by ${input.changedBy}` : "manual adjustment"),
            });
        }
        return { delta };
    });
}

/**
 * 释放某订单的在途预留（审查 H-2）：把 createOrder 占的 `inventory.reserved` 按快照精确回退并清空 orders.reservation。
 *
 * 幂等：先 `SELECT ... FOR UPDATE` 锁住订单行再读快照——发货/退款/未付过期三条路径并发调用时，
 * 行锁把它们串行化，只有第一个看到非空快照的人会真减 reserved，其余看到已置 null 即空转（恰好释放一次）。
 * ⚠ 必须在调用方事务内执行（与主写同事务），锁才持续到提交；`.for("update")` 要写在 `.limit(1)` 之后才生成合法的 `LIMIT n FOR UPDATE`。
 */
export async function releaseReservation(db: Db | Tx, orderId: string): Promise<void> {
    const order = (
        await db.select({ reservation: orders.reservation }).from(orders).where(eq(orders.id, orderId)).limit(1).for("update")
    )[0];
    const snap = order?.reservation as Record<string, number> | null | undefined;
    if (!snap) return;

    await db.update(orders).set({ reservation: null }).where(eq(orders.id, orderId));
    for (const [variantId, qty] of Object.entries(snap)) {
        await db
            .update(inventory)
            .set({ reserved: sql`${inventory.reserved} - ${qty}::int`, updatedAt: new Date() })
            .where(eq(inventory.variantId, variantId));
    }
}

/**
 * 释放超时未付订单的在途预留（审查 H-2 的回收环节）：下单占位后用户放弃付款的单，
 * 若不回收会把库存永久锁住（刷单即可锁死）。定时扫出“未付 + 仍持有预留 + 未发货 + 创建超 TTL”的单，
 * 逐张原子认领（翻 cancelled）并回退 reserved。返回释放张数供 cron 记日志。
 *
 * 幂等/并发：每张单独事务，认领靠 `WHERE payment_status='unpaid' AND reservation IS NOT NULL AND fulfillment_status='unfulfilled'`
 * 的条件更新（抢输则 0 行→跳过，不会与已支付/已发货/别的回收撞）。TTL 要大于真实支付窗口（默认 60 分）。
 */
export async function releaseExpiredReservations(db: Db | Tx, opts: { ttlMinutes: number; limit: number }): Promise<number> {
    const cutoff = new Date(Date.now() - opts.ttlMinutes * 60_000);
    const candidates = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
            and(
                eq(orders.paymentStatus, "unpaid"),
                eq(orders.fulfillmentStatus, "unfulfilled"),
                isNotNull(orders.reservation),
                lt(orders.createdAt, cutoff),
            ),
        )
        .limit(opts.limit);

    let released = 0;
    for (const c of candidates) {
        await db.transaction(async (tx) => {
            // 原子认领：仅当仍未付/未发/持有时翻 cancelled，并取回当前预留快照（RETURNING 读的是本次未改的 reservation 列）。
            const claimed = (
                await tx
                    .update(orders)
                    .set({ status: "cancelled" })
                    .where(
                        and(
                            eq(orders.id, c.id),
                            eq(orders.paymentStatus, "unpaid"),
                            eq(orders.fulfillmentStatus, "unfulfilled"),
                            isNotNull(orders.reservation),
                        ),
                    )
                    .returning({ reservation: orders.reservation })
            )[0];
            if (!claimed?.reservation) return; // 已被支付/发货/别的进程认领 → 跳过
            await releaseReservation(tx, c.id); // 回退 reserved + 清 snapshot
            released++;
        });
    }
    return released;
}
