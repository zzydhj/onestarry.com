/**
 * schema/payments.ts —— 支付域（§15 步骤 12a）
 * provider/status 一律 text（加 PSP / 加状态不改结构，§18）。金额整数分。
 * webhook_events 用 (provider, provider_event_id) 唯一约束做幂等接收。
 */
import { pgTable, uuid, text, bigint, jsonb, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps } from "./columns";
import { paymentProviderAccounts } from "./foundation";
import { orders } from "./orders";

export const payments = pgTable(
    "payments",
    {
        ...timestamps(),
        id: id(),
        orderId: uuid("order_id").notNull().references(() => orders.id),
        provider: text("provider").notNull(), // stripe | paypal | ...
        providerAccountId: uuid("provider_account_id").references(() => paymentProviderAccounts.id),
        providerRef: text("provider_ref"), // PaymentIntent / capture id
        amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
        currency: text("currency").notNull(),
        feeCents: bigint("fee_cents", { mode: "number" }).notNull().default(0),
        feeCurrency: text("fee_currency"),
        status: text("status").notNull().default("pending"), // pending | succeeded | failed | refunded
        capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }),
        metadata: jsonb("metadata"),
    },
    (t) => [
        uniqueIndex("pay_provider_ref_uq").on(t.provider, t.providerRef),
        index("pay_order_idx").on(t.orderId),
        // 支付额不得为负（退款走 refunds 表，不靠写一笔负支付表达）。DB 层只保底线：
        // “金额必须等于订单应付”这种跨表规则留在 recordPaymentSucceeded，那里才能读两边。
        check("payment_amount_nonneg", sql`${t.amountCents} >= 0`),
    ],
);

export const refunds = pgTable(
    "refunds",
    {
        ...timestamps(),
        id: id(),
        paymentId: uuid("payment_id").notNull().references(() => payments.id),
        orderId: uuid("order_id").notNull().references(() => orders.id),
        provider: text("provider").notNull(),
        providerRef: text("provider_ref"),
        amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
        currency: text("currency").notNull(),
        reason: text("reason"),
        status: text("status").notNull().default("pending"), // pending | succeeded | failed
    },
    (t) => [index("refund_payment_idx").on(t.paymentId), index("refund_order_idx").on(t.orderId)],
);

export const payouts = pgTable(
    "payouts",
    {
        ...timestamps(),
        id: id(),
        provider: text("provider").notNull(),
        providerAccountId: uuid("provider_account_id").references(() => paymentProviderAccounts.id),
        providerRef: text("provider_ref"),
        amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
        currency: text("currency").notNull(),
        arrivalDate: timestamp("arrival_date", { withTimezone: true, mode: "date" }),
        status: text("status").notNull().default("pending"), // pending | in_transit | paid | failed
    },
    (t) => [uniqueIndex("payout_provider_ref_uq").on(t.provider, t.providerRef)],
);

export const disputes = pgTable(
    "disputes",
    {
        ...timestamps(),
        id: id(),
        paymentId: uuid("payment_id").references(() => payments.id),
        orderId: uuid("order_id").references(() => orders.id),
        provider: text("provider").notNull(),
        providerRef: text("provider_ref"),
        amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
        currency: text("currency").notNull(),
        reason: text("reason"),
        status: text("status").notNull().default("open"), // open | under_review | responded | won | lost | accepted
        evidenceDueAt: timestamp("evidence_due_at", { withTimezone: true, mode: "date" }),
        raw: jsonb("raw"),
    },
    (t) => [uniqueIndex("dispute_provider_ref_uq").on(t.provider, t.providerRef), index("dispute_order_idx").on(t.orderId)],
);

// Webhook 幂等接收：(provider, provider_event_id) 唯一
export const webhookEvents = pgTable(
    "webhook_events",
    {
        ...timestamps(),
        id: id(),
        provider: text("provider").notNull(),
        providerEventId: text("provider_event_id").notNull(),
        type: text("type").notNull(), // payment_intent.succeeded | charge.refunded | ...
        payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
        status: text("status").notNull().default("received"), // received | processed | failed | ignored
        processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
        error: text("error"),
    },
    (t) => [uniqueIndex("wh_provider_event_uq").on(t.provider, t.providerEventId), index("wh_status_idx").on(t.status)],
);
