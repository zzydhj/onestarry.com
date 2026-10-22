import { desc, eq, sql } from "drizzle-orm";
import { orders } from "../schema";
import { orderCols, type OrderLineRow } from "./orders";
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

/** 订单明细行（带 SKU）。 */
export interface AdminOrderItemRow {
    id: string;
    variantId: string;
    sku: string | null;
    quantity: number;
    unitPriceCents: number;
    snapshot: unknown;
}

/** 发货单（详情页面只用到几个字段，但形状与旧的一致）。 */
export interface AdminShipmentRow {
    id: string;
    orderId: string;
    carrier: string | null;
    trackingNumber: string | null;
    status: string;
    shippedAt: string | null;
}

/**
 * 订单详情：主单 + 明细（带 SKU）+ 行 + 发货单。
 * **一条 SQL 拿齐四块**（旧写法 4 次串行往返；后台天天开的就是这页）。
 * 子聚合显式给驼峰键；订单头走 drizzle 列所 `created_at` 仍是 Date，不是 ISO 字符串。
 * ⚠ 外层列在子查询里必须写完整限定名 "orders"."id"（同 orders.ts 里的 42702 坑）。
 */
export async function getOrderDetail(db: Db | Tx, orderId: string) {
    const [row] = await db
        .select({
            ...orderCols,
            itemsJson: sql<unknown>`coalesce((
                select json_agg(json_build_object(
                    'id', oi.id, 'variantId', oi.variant_id, 'sku', pv.sku,
                    'quantity', oi.quantity, 'unitPriceCents', oi.unit_price_cents, 'snapshot', oi.snapshot))
                from order_items oi
                left join product_variants pv on pv.id = oi.variant_id
                where oi.order_id = "orders"."id"
            ), '[]'::json)`,
            linesJson: sql<unknown>`coalesce((
                select json_agg(json_build_object(
                    'id', ol.id, 'orderId', ol.order_id, 'orderItemId', ol.order_item_id,
                    'type', ol.type, 'description', ol.description, 'amountCents', ol.amount_cents,
                    'taxRate', ol.tax_rate, 'dutyQuoteSnapshot', ol.duty_quote_snapshot))
                from order_lines ol where ol.order_id = "orders"."id"
            ), '[]'::json)`,
            shipmentJson: sql<unknown>`(
                select json_build_object(
                    'id', s.id, 'orderId', s.order_id, 'carrier', s.carrier,
                    'trackingNumber', s.tracking_number, 'status', s.status, 'shippedAt', s.shipped_at)
                from shipments s where s.order_id = "orders"."id" limit 1
            )`,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
    if (!row) return null;
    const { itemsJson, linesJson, shipmentJson, ...order } = row;
    return {
        order,
        items: itemsJson as AdminOrderItemRow[],
        lines: linesJson as OrderLineRow[],
        shipment: (shipmentJson as AdminShipmentRow | null) ?? null,
    };
}
