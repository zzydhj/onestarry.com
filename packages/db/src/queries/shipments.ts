import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
    inventory,
    ledgerEntries,
    ledgerTransactions,
    markets,
    orderItems,
    orders,
    productVariants,
    shipments,
    stockMovements,
} from "../schema";
import { emitEvent } from "./outbox";
import { requireAccountId } from "./ledger";
import { releaseReservation } from "./inventory";
import type { Db, Tx } from "../client";

export interface RecordShipmentInput {
    orderId: string;
    carrier?: string;
    trackingNumber?: string;
    labelUrl?: string;
    customsDeclaration?: Record<string, unknown>;
}

export interface RecordShipmentResult {
    shipmentId: string;
    cogsCents: number;
}

/**
 * 发货确认收入/COGS（§3.6 两段式·发货段）。接收 Db|Tx，由调用方在事务里包。
 * 借 customer_deposits(货净额+运费) / 贷 revenue + shipping_revenue；
 * 借 cogs / 贷 inventory_asset（COGS 用 variant.cost_cents 近似，移动平均留后续）；
 * 扣 inventory.on_hand + 写 stock_movements.sale；订单转 fulfilled；发 order.shipped 事件。
 * 税/关税已在支付段确认为负债，发货段不再动（§3.6）。
 */
export async function recordShipment(db: Db | Tx, input: RecordShipmentInput): Promise<RecordShipmentResult> {
    // 并发双击「标记发货」（或 action 因网络重试被重放）会重复确认收入 + 重复扣库存 + 生成两张运单（审查 C-1）。
    // READ COMMITTED 下无锁读两个事务都能过下面的 fulfilled 检查 → 必须 FOR UPDATE 锁住订单行串行化（调用方已在事务内包）；
    // 下面还有条件更新守卫 + shipments(order_id) 部分唯一索引作双兜底（与退款去重同类）。
    const order = (await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update"))[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.paymentStatus !== "paid") throw new Error("ORDER_NOT_PAID");
    if (order.fulfillmentStatus === "fulfilled") throw new Error("ALREADY_FULFILLED");

    const market = (
        await db.select({ legalEntityId: markets.legalEntityId }).from(markets).where(eq(markets.id, order.marketId)).limit(1)
    )[0];
    if (!market) throw new Error("MARKET_NOT_FOUND");
    const legalEntityId = market.legalEntityId;
    const currency = order.currency;

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));

    // COGS（MVP 近似：参考成本 × 数量；移动平均留后续）。一次 inArray 批量取成本（旧写法逐行查 = N+1）。
    // 审查 M-3：costCents 为 NULL（未设参考成本）与 0（真免费）必须区分——旧写法 `?? 0` 把未知当 0，
    // 于是下面 `.filter(e => e.amount !== 0)` 会把 cogs/inventory_asset 两条整个吞掉 → 确认了收入却
    // 没确认任何成本、利润虚增且无痕。未定价的单不该能“静默发货”：抛错让运营先补成本。
    const costRows = items.length
        ? await db
            .select({ id: productVariants.id, costCents: productVariants.costCents })
            .from(productVariants)
            .where(inArray(productVariants.id, items.map((it) => it.variantId)))
        : [];
    const costById = new Map(costRows.map((c) => [c.id, c.costCents]));
    let cogsCents = 0;
    for (const it of items) {
        if (!costById.has(it.variantId)) throw new Error(`COGS_VARIANT_MISSING:${it.variantId}`);
        const cost = costById.get(it.variantId);
        if (cost == null) throw new Error(`COGS_COST_UNKNOWN:${it.variantId}`);
        cogsCents += cost * it.quantity;
    }

    const [accDep, accRev, accShipRev, accCogs, accInv] = await Promise.all([
        requireAccountId(db, legalEntityId, "customer_deposits"),
        requireAccountId(db, legalEntityId, "revenue"),
        requireAccountId(db, legalEntityId, "shipping_revenue"),
        requireAccountId(db, legalEntityId, "cogs"),
        requireAccountId(db, legalEntityId, "inventory_asset"),
    ]);

    const [shipment] = await db
        .insert(shipments)
        .values({
            orderId: order.id,
            carrier: input.carrier,
            trackingNumber: input.trackingNumber,
            labelUrl: input.labelUrl,
            status: "shipped",
            shippedAt: new Date(),
            dutyQuotedCents: order.dutyCents,
            customsDeclaration: input.customsDeclaration,
        })
        .returning();
    if (!shipment) throw new Error("SHIPMENT_INSERT_FAILED");

    const [txn] = await db
        .insert(ledgerTransactions)
        .values({ legalEntityId, referenceType: "shipment", referenceId: shipment.id, memo: `Shipment ${input.trackingNumber ?? ""}` })
        .returning();
    if (!txn) throw new Error("LEDGER_TXN_FAILED");

    const goodsNet = order.subtotalCents - order.discountCents;
    const entries = [
        { accountId: accDep, direction: "debit" as const, amount: goodsNet + order.shippingCents },
        { accountId: accRev, direction: "credit" as const, amount: goodsNet },
        { accountId: accShipRev, direction: "credit" as const, amount: order.shippingCents },
        { accountId: accCogs, direction: "debit" as const, amount: cogsCents },
        { accountId: accInv, direction: "credit" as const, amount: cogsCents },
    ].filter((e) => e.amount !== 0);

    const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0);
    const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0);
    if (debit !== credit) throw new Error(`LEDGER_IMBALANCE:${debit}!=${credit}`);

    await db.insert(ledgerEntries).values(
        entries.map((e) => ({
            transactionId: txn.id,
            accountId: e.accountId,
            direction: e.direction,
            amountFunctional: e.amount,
            amountOriginal: e.amount,
            currencyOriginal: currency,
            fxRate: "1",
        })),
    );

    // 扣库存 + 写 sale 流水
    for (const it of items) {
        const inv = await db
            .insert(inventory)
            .values({ variantId: it.variantId, onHand: -it.quantity, reserved: 0 })
            .onConflictDoUpdate({
                target: inventory.variantId,
                set: { onHand: sql`${inventory.onHand} - ${it.quantity}`, updatedAt: new Date() },
            })
            .returning({ onHand: inventory.onHand });
        const onHandAfter = inv[0]?.onHand ?? null;
        await db.insert(stockMovements).values({
            variantId: it.variantId,
            type: "sale",
            quantity: -it.quantity,
            onHandAfter,
            referenceType: "order",
            referenceId: order.id,
        });
    }

    // H-2：发货消耗——goods 已从 on_hand 递减（上面循环），这里把这张单下单时占的 reserved 精确回退。
    // 与 recordShipment 顶部的 FOR UPDATE 同属一个事务，释放幂等（快照置 null 后重复调为空转）。
    await releaseReservation(db, order.id);

    // 二次兜底：带上 `<> 'fulfilled'` 条件更新，用 .returning() 判断是否真的命中。FOR UPDATE 已串行化，
    // 这里再防止未来有人拿非事务的 Db 直接调（那时 FOR UPDATE 无效），避免静默覆盖同值。
    const moved = await db
        .update(orders)
        .set({ fulfillmentStatus: "fulfilled" })
        .where(and(eq(orders.id, order.id), ne(orders.fulfillmentStatus, "fulfilled")))
        .returning({ id: orders.id });
    if (!moved[0]) throw new Error("ALREADY_FULFILLED");

    await emitEvent(db, {
        aggregateType: "order",
        aggregateId: order.id,
        eventType: "order.shipped",
        payload: { shipmentId: shipment.id, trackingNumber: input.trackingNumber ?? null, cogsCents },
    });

    return { shipmentId: shipment.id, cogsCents };
}
