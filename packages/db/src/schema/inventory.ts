/**
 * schema/inventory.ts —— 库存（§15 步骤 8）
 * 商业模式：单一自有仓（中国自有仓直发），故每个 variant 一行库存，无多仓/多货位。
 * - inventory.available 用 DB 生成列 = on_hand - reserved（派生非第二真源，永不漂移）。
 * - stock_movements 只追加（sale|return|adjustment|receive|damage），迁移 SQL 里 REVOKE UPDATE/DELETE。
 *   COGS 移动平均以 unit_cost_cents 为准（cost_cents 仅参考）。
 */
import { pgTable, pgEnum, uuid, integer, bigint, text, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, timestamps } from "./columns";
import { productVariants } from "./catalog";

export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
    "sale",
    "return",
    "adjustment",
    "receive",
    "damage",
]);

export const inventory = pgTable("inventory", {
    ...timestamps(),
    variantId: uuid("variant_id")
        .primaryKey()
        .references(() => productVariants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    // 生成列：应用层只读，插入/更新由 PG 维护
    available: integer("available").generatedAlwaysAs(sql`("on_hand" - "reserved")`),
});

export const stockMovements = pgTable(
    "stock_movements",
    {
        ...timestamps(),
        id: id(),
        variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
        type: stockMovementTypeEnum("type").notNull(),
        quantity: integer("quantity").notNull(), // 对 on_hand 的带符号增量（receive +, sale/damage -）
        onHandAfter: integer("on_hand_after"), // 记账后快照，便于对账
        unitCostCents: bigint("unit_cost_cents", { mode: "number" }), // 收货成本（折本位币前）；移动平均用
        referenceType: text("reference_type"), // order | receive | adjustment | external
        referenceId: uuid("reference_id"),
        note: text("note"),
    },
    (t) => [index("sm_variant_idx").on(t.variantId), index("sm_ref_idx").on(t.referenceType, t.referenceId)],
);
