/**
 * schema/pricing.ts —— 定价物化缓存 + 价格历史（§15 步骤 9 / §3.3 / §6.1）
 *
 * variant_market_prices：PDP / 搜索 price.{market} / Merchant feed / Omnibus 的共同派生来源。
 *   是缓存不是真源——由 computeLandedPrice 从 基价/运费/税率/关税率/汇率/市场策略 重算写入。
 *   inputs_hash 命中则跳过重算；duty_rules/HS/基价/汇率任一变 → Outbox 触发重算。
 * price_history：每次 list 价变更留痕，Omnibus「降价前 30 天内最低价」取数依据
 *   （reason 仅 manual|promotion 计入 Omnibus；duty_recalc|fx_recalc 不算促销）。
 */
import {
    pgTable,
    pgEnum,
    uuid,
    text,
    boolean,
    bigint,
    numeric,
    timestamp,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";
import { dutyPresentationEnum, markets, pricingModeEnum } from "./foundation";
import { productVariants } from "./catalog";

export const priceChangeReasonEnum = pgEnum("price_change_reason", [
    "manual",
    "promotion",
    "duty_recalc",
    "fx_recalc",
]);

export const variantMarketPrices = pgTable(
    "variant_market_prices",
    {
        ...timestamps(),
        id: id(),
        variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
        marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
        currency: text("currency").notNull(),
        goodsCents: bigint("goods_cents", { mode: "number" }).notNull(),
        shippingCents: bigint("shipping_cents", { mode: "number" }).notNull().default(0),
        dutyCents: bigint("duty_cents", { mode: "number" }).notNull().default(0), // = embedded_duty_cents
        taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
        listPriceCents: bigint("list_price_cents", { mode: "number" }).notNull(), // 展示价
        allInCents: bigint("all_in_cents", { mode: "number" }).notNull(), // 客户实付全包（DDP）
        blocked: boolean("blocked").notNull().default(false), // 超每票阈值拦截
        pricingMode: pricingModeEnum("pricing_mode").notNull(),
        dutyPresentation: dutyPresentationEnum("duty_presentation").notNull(),
        fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
        inputsHash: text("inputs_hash").notNull(),
        computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("vmp_variant_market_uq").on(t.variantId, t.marketId),
        index("vmp_market_idx").on(t.marketId),
    ],
);

export const priceHistory = pgTable(
    "price_history",
    {
        ...timestamps(),
        id: id(),
        variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
        marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
        currency: text("currency").notNull(),
        oldListPriceCents: bigint("old_list_price_cents", { mode: "number" }).notNull(),
        newListPriceCents: bigint("new_list_price_cents", { mode: "number" }).notNull(),
        reason: priceChangeReasonEnum("reason").notNull(),
        changedBy: uuid("changed_by"), // admin 用户 id；系统重算为 null
        validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
        validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
    },
    (t) => [index("ph_variant_market_time_idx").on(t.variantId, t.marketId, t.validFrom)],
);
