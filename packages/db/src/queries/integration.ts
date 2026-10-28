import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { inventory, orderItems, orders, productVariants, stockMovements } from "../schema";
import type { Db, Tx } from "../client";

/**
 * 对外集成 API 数据层（§13 / 步骤 14，"只进不出"）。
 * 读接口脱敏（无客户 PII），写接口经核心校验回写库存事实。外部采购/生产程序经 Cloudflare Access 调用。
 * 账本自动化（入库成本入 inventory_asset）刻意留 TODO——本模板只保留接口，不做进系统。
 */

export interface DemandRow {
    variantId: string;
    sku: string;
    hsCode: string | null;
    countryOfOrigin: string | null;
    quantity: number; // 已支付未发货订单行的合计数量
}

/**
 * 需求流水（脱敏）：已支付、未完全发货的订单按变体聚合数量 + SKU + HS + 原产国。
 * 绝不含客户姓名/地址/邮箱（§13 防 PII 泄露）。sinceDays 限定近 N 天。
 */
export async function getDemandFeed(db: Db | Tx, opts: { sinceDays?: number; limit?: number } = {}): Promise<DemandRow[]> {
    const sinceDays = opts.sinceDays ?? 30;
    const limit = opts.limit ?? 500;
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    return db
        .select({
            variantId: orderItems.variantId,
            sku: productVariants.sku,
            hsCode: productVariants.hsCode,
            countryOfOrigin: productVariants.countryOfOrigin,
            quantity: sql<number>`sum(${orderItems.quantity})::int`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .where(
            and(
                eq(orders.paymentStatus, "paid"),
                inArray(orders.fulfillmentStatus, ["unfulfilled", "partial"]),
                gte(orders.createdAt, since),
            ),
        )
        .groupBy(orderItems.variantId, productVariants.sku, productVariants.hsCode, productVariants.countryOfOrigin)
        .orderBy(sql`sum(${orderItems.quantity}) desc`)
        .limit(limit);
}

export interface InventoryLevelRow {
    variantId: string;
    sku: string;
    onHand: number;
    reserved: number;
    available: number;
}

/** 库存水位（驱动采购）：全变体 on_hand/reserved/available + SKU，按可用升序（低水位在前）。 */
export async function getInventoryLevels(db: Db | Tx, opts: { limit?: number } = {}): Promise<InventoryLevelRow[]> {
    const limit = opts.limit ?? 2000;
    return db
        .select({
            variantId: inventory.variantId,
            sku: productVariants.sku,
            onHand: inventory.onHand,
            reserved: inventory.reserved,
            available: sql<number>`coalesce(${inventory.available}, 0)::int`,
        })
        .from(inventory)
        .innerJoin(productVariants, eq(inventory.variantId, productVariants.id))
        .orderBy(inventory.available)
        .limit(limit);
}

export interface ReceiveInput {
    variantId: string;
    qtyReceived: number;
    qtyDamaged?: number;
    unitCostCents: number;
    currency: string;
    supplierRef?: string | null;
    externalPoRef?: string | null;
}

/**
 * 入库回写（"进"）：追加 receive 流水（含单位成本）+（若有）damage 流水，并增加 on_hand。
 * available 为 DB 生成列自动跟随。⚠️ 账本分录（借 inventory_asset / 贷 external_ap_clearing，
 * 按收货日汇率折 USD 入成本）留 TODO——属"做进系统"的财务自动化，本模板仅保留接口与库存事实回写。
 */
export async function receiveStock(db: Db | Tx, input: ReceiveInput): Promise<{ onHandAfter: number }> {
    const damaged = input.qtyDamaged ?? 0;
    const net = input.qtyReceived - damaged; // on_hand 的带符号净增量

    // 并发安全（审查 M1）：无行则新建（on_hand 初值=净增量），有行则 `on_hand = on_hand + net` 增量式更新；
    // RETURNING 拿并发后的真值（与 recordShipment 同一口径）——旧写法先 SELECT 再写绝对值，并发丢更新。
    // 前提：本函数必须在调用方事务内执行，以便与幂等键写入同事务（见 route）。
    const updated = await db
        .insert(inventory)
        .values({ variantId: input.variantId, onHand: net, reserved: 0 })
        .onConflictDoUpdate({
            target: inventory.variantId,
            set: { onHand: sql`${inventory.onHand} + ${net}`, updatedAt: new Date() },
        })
        .returning({ onHand: inventory.onHand });
    const onHandAfter = updated[0]?.onHand ?? 0;

    await db.insert(stockMovements).values({
        variantId: input.variantId,
        type: "receive",
        quantity: input.qtyReceived,
        onHandAfter,
        unitCostCents: input.unitCostCents,
        referenceType: "receive",
        note: JSON.stringify({
            currency: input.currency,
            supplierRef: input.supplierRef ?? null,
            externalPoRef: input.externalPoRef ?? null,
        }),
    });

    if (damaged > 0) {
        await db.insert(stockMovements).values({
            variantId: input.variantId,
            type: "damage",
            quantity: -damaged,
            onHandAfter,
            referenceType: "receive",
            note: "damaged at receive",
        });
    }
    // TODO(§13): 借 inventory_asset / 贷 external_ap_clearing（收货日汇率折本位币 USD）。
    return { onHandAfter };
}
