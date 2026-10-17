/**
 * schema/shipments.ts —— 运单/履约（§15 步骤 13）
 * 自有仓直发：发货在本系统建 shipment + 报关；承运商（中国专线）经 ShippingProvider 接口可插拔。
 * duty_quoted（向客户收，进 duty_collected）/ duty_actual（承运商实付）/ 差额走 duty_variance（§6.3 代收代付）。
 */
import { pgTable, uuid, text, bigint, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";
import { carriers } from "./foundation";
import { orders } from "./orders";

export const shipments = pgTable(
    "shipments",
    {
        ...timestamps(),
        id: id(),
        orderId: uuid("order_id").notNull().references(() => orders.id),
        carrier: text("carrier"), // 专线承运商标识（可插拔，text 可扩展）
        carrierId: uuid("carrier_id").references(() => carriers.id),
        trackingNumber: text("tracking_number"),
        labelUrl: text("label_url"),
        status: text("status").notNull().default("pending"), // pending | label_purchased | shipped | delivered | returned
        shippedAt: timestamp("shipped_at", { withTimezone: true, mode: "date" }),
        dutyQuotedCents: bigint("duty_quoted_cents", { mode: "number" }).notNull().default(0),
        dutyActualCents: bigint("duty_actual_cents", { mode: "number" }),
        dutyInvoiceRef: text("duty_invoice_ref"),
        customsDeclaration: jsonb("customs_declaration"), // HS/原产国/申报价值/incoterm/IOSS 号
    },
    (t) => [index("ship_order_idx").on(t.orderId), index("ship_tracking_idx").on(t.trackingNumber)],
);
