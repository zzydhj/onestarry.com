/**
 * schema/orders.ts —— 订单/结账域（§15 步骤 11）
 *
 * ⚠️ 分区说明：orders / order_items / order_lines 是未来分区大表（RANGE by created_at，PK 含 created_at）。
 *   当前无生产数据，先建普通表跑通逻辑；上线前用专门迁移重建为分区表（空表重建成本为零），
 *   届时 PK 改复合 (id, created_at)、按月子分区。见文档 §4/§5。
 * 金额一律整数分；provider/status 用可扩展类型。
 */
import {
    pgTable,
    pgEnum,
    uuid,
    text,
    boolean,
    integer,
    bigint,
    numeric,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
    check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps } from "./columns";
import { markets } from "./foundation";
import { productVariants } from "./catalog";

export const addressTypeEnum = pgEnum("address_type", ["shipping", "billing"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "paid", "cancelled", "refunded", "completed"]);
export const paymentStatusEnum = pgEnum("payment_status", ["unpaid", "authorized", "paid", "partially_refunded", "refunded", "disputed"]);
export const fulfillmentStatusEnum = pgEnum("fulfillment_status", ["unfulfilled", "partial", "fulfilled", "returned"]);
export const orderLineTypeEnum = pgEnum("order_line_type", ["item", "shipping", "discount", "tax", "duty", "fee", "gift_card", "store_credit"]);
export const promotionTypeEnum = pgEnum("promotion_type", ["percent_off", "fixed_amount", "free_shipping", "buy_x_get_y"]);
export const promotionStatusEnum = pgEnum("promotion_status", ["draft", "active", "expired", "disabled"]);

export const addresses = pgTable(
    "addresses",
    {
        ...timestamps(),
        id: id(),
        customerId: text("customer_id"), // Better Auth customer_user.id；游客可空
        label: text("label"),
        recipient: text("recipient").notNull(),
        phone: text("phone"),
        country: text("country").notNull(), // ISO 3166-1 alpha-2
        region: text("region"),
        city: text("city"),
        district: text("district"),
        line1: text("line1").notNull(),
        line2: text("line2"),
        postalCode: text("postal_code"),
        addressType: addressTypeEnum("address_type").notNull().default("shipping"),
        isDefault: boolean("is_default").notNull().default(false),
        metadata: jsonb("metadata"),
    },
    (t) => [index("addr_customer_idx").on(t.customerId)],
);

// 幂等键（铁律②：Server Action 幂等，防重复下单）
export const idempotencyKeys = pgTable(
    "idempotency_keys",
    {
        ...timestamps(),
        id: id(),
        key: text("key").notNull(),
        scope: text("scope").notNull(), // checkout.create | payment.webhook | ...
        responseHash: text("response_hash"),
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    },
    (t) => [uniqueIndex("idem_key_scope_uq").on(t.key, t.scope), index("idem_expires_idx").on(t.expiresAt)],
);

export const promotions = pgTable(
    "promotions",
    {
        ...timestamps(),
        id: id(),
        code: text("code"), // null=自动生效（如满赠）；非空=需输入码
        name: text("name").notNull(),
        type: promotionTypeEnum("type").notNull(),
        value: bigint("value", { mode: "number" }).notNull(), // 百分比(基点)或金额分，按 type
        currency: text("currency"), // fixed_amount 用
        minSubtotalCents: bigint("min_subtotal_cents", { mode: "number" }),
        rules: jsonb("rules"), // 适用范围：productIds/categoryIds/marketIds/…
        startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
        endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
        usageLimit: integer("usage_limit"),
        perCustomerLimit: integer("per_customer_limit"),
        usedCount: integer("used_count").notNull().default(0),
        status: promotionStatusEnum("status").notNull().default("draft"),
    },
    (t) => [uniqueIndex("promo_code_uq").on(t.code), index("promo_status_idx").on(t.status)],
);

export const orders = pgTable(
    "orders",
    {
        ...timestamps(),
        id: id(),
        orderNumber: text("order_number").notNull(), // 人类可读单号
        status: orderStatusEnum("status").notNull().default("pending"),
        paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
        fulfillmentStatus: fulfillmentStatusEnum("fulfillment_status").notNull().default("unfulfilled"),
        customerId: text("customer_id"), // 游客可空
        email: text("email").notNull(),
        marketId: uuid("market_id").notNull().references(() => markets.id),
        locale: text("locale").notNull().default("en"),
        currency: text("currency").notNull(),
        shippingAddressId: uuid("shipping_address_id").references(() => addresses.id),
        billingAddressId: uuid("billing_address_id").references(() => addresses.id),
        addressSnapshot: jsonb("address_snapshot"), // 下单时地址固化（改址不影响历史）
        paymentProvider: text("payment_provider"), // stripe | paypal | ...（text 可扩展）
        subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
        discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
        shippingCents: bigint("shipping_cents", { mode: "number" }).notNull().default(0),
        taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
        dutyCents: bigint("duty_cents", { mode: "number" }).notNull().default(0),
        totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
        refundedCents: bigint("refunded_cents", { mode: "number" }).notNull().default(0),
        placedAt: timestamp("placed_at", { withTimezone: true, mode: "date" }),
        notes: text("notes"),
    },
    (t) => [
        uniqueIndex("order_number_uq").on(t.orderNumber),
        index("order_customer_idx").on(t.customerId),
        index("order_status_placed_idx").on(t.status, t.placedAt),
        // 金额底线（2026-10-23 审查 P0-3 的最后一层）：应用层已校数量与金额，但
        // createOrder 之外还有导入/集成/脚本等写入口，负数单一入库就是账本与发票垃圾。
        check("order_total_nonneg", sql`${t.totalCents} >= 0`),
        check("order_discount_nonneg", sql`${t.discountCents} >= 0`),
    ],
);

export const orderItems = pgTable(
    "order_items",
    {
        ...timestamps(),
        id: id(),
        orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
        variantId: uuid("variant_id").notNull().references(() => productVariants.id),
        quantity: integer("quantity").notNull(),
        unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
        snapshot: jsonb("snapshot").notNull(), // 固化标题/图/选项值/税率（改名改价不影响历史，EU 发票要求）
    },
    (t) => [
        index("oi_order_idx").on(t.orderId),
        index("oi_variant_idx").on(t.variantId),
        // 数量必须是正整数且不超过上限：cookie 里的购物车是用户可改的，这一层是 DB 兜底。
        // 上限给到 10000（比应用层 999 宽）：后台补录/批发单可能需要更大数量，不至于被 DB 硬拦。
        check("oi_quantity_range", sql`${t.quantity} > 0 AND ${t.quantity} <= 10000`),
    ],
);

export const orderLines = pgTable(
    "order_lines",
    {
        ...timestamps(),
        id: id(),
        orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
        orderItemId: uuid("order_item_id").references(() => orderItems.id, { onDelete: "cascade" }), // 仅 item 行有
        type: orderLineTypeEnum("type").notNull(),
        description: text("description"),
        amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
        taxRate: numeric("tax_rate", { precision: 8, scale: 6 }),
        dutyQuoteSnapshot: jsonb("duty_quote_snapshot"), // 关税行：税率/HS/来源/时间，争议可举证
    },
    (t) => [index("ol_order_idx").on(t.orderId), index("ol_type_idx").on(t.type)],
);
