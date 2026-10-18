import { asc, desc, eq } from "drizzle-orm";
import { orderItems, orderLines, orders, productVariants, shipments } from "../schema";
import type { Db, Tx } from "../client";

/** 最近订单（后台列表用，按创建时间倒序）。 */
export async function listRecentOrders(db: Db | Tx, limit = 100) {
    return db
        .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            email: orders.email,
            currency: orders.currency,
            totalCents: orders.totalCents,
            paymentStatus: orders.paymentStatus,
            fulfillmentStatus: orders.fulfillmentStatus,
            createdAt: orders.createdAt,
        })
        .from(orders)
        .orderBy(desc(orders.createdAt))
        .limit(limit);
}

/** 某客户的订单（前台“我的订单”用，按创建时间倒序）。 */
export async function listOrdersByCustomer(db: Db | Tx, customerId: string, limit = 50) {
    return db
        .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            currency: orders.currency,
            totalCents: orders.totalCents,
            paymentStatus: orders.paymentStatus,
            fulfillmentStatus: orders.fulfillmentStatus,
            createdAt: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.customerId, customerId))
        .orderBy(desc(orders.createdAt))
        .limit(limit);
}

/** 订单详情：主单 + 明细（带 SKU）+ 行 + 发货单（若有）。 */
export async function getOrderDetail(db: Db | Tx, orderId: string) {
    const order = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
    if (!order) return null;
    const items = await db
        .select({
            id: orderItems.id,
            variantId: orderItems.variantId,
            sku: productVariants.sku,
            quantity: orderItems.quantity,
            unitPriceCents: orderItems.unitPriceCents,
            snapshot: orderItems.snapshot,
        })
        .from(orderItems)
        .leftJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .where(eq(orderItems.orderId, orderId))
        .orderBy(asc(orderItems.createdAt));
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const shipment = (await db.select().from(shipments).where(eq(shipments.orderId, orderId)).limit(1))[0] ?? null;
    return { order, items, lines, shipment };
}
