/**
 * schema/inventory.ts —— 库存（§15 步骤 8）
 * 商业模式：单一自有仓（中国自有仓直发），故每个 variant 一行库存，无多仓/多货位。
 * - inventory.available 用 DB 生成列 = on_hand - reserved（派生非第二真源，永不漂移）。
 * - stock_movements 只追加（sale|return|adjustment|receive|damage），迁移 SQL 里 REVOKE UPDATE/DELETE。
 *   COGS 移动平均以 unit_cost_cents 为准（cost_cents 仅参考）。
 */
import { pgTable, pgEnum, uuid, integer, bigint, text, index, check } from "drizzle-orm/pg-core";
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
    (t) => [
        index("sm_variant_idx").on(t.variantId),
        index("sm_ref_idx").on(t.referenceType, t.referenceId),
        // 审查第三轮 schema 漂移：quantity 是“对 on_hand 的带符号增量”，符号必须与 type 一致——
        // 否则发货把扣库误写成 +（反而增库存）、入库写成负 这类“符号写反”在 DB 层发现不了。
        // sale/damage 必为负；receive/return 必为正；adjustment 任意非零。receive 路由已保证 qtyReceived>0、damage 仅在>0 时写负。
        // 不给 on_hand_after 加 >=0：inventory.on_hand 本身无此约束（超卖/backorder 允许负），负快照是合法真实状态。
        // ⚠ CHECK 表达式必须用裸列名（"type"/"quantity"），不能写 ${t.type} 那类表限定名——
        //   PG 里 CHECK 无 FROM 上下文，限定成 "stock_movements"."quantity" 会报 42P01 missing FROM-clause。
        check(
            "sm_qty_sign",
            sql`case
                when "type" in ('sale', 'damage') then "quantity" < 0
                when "type" in ('receive', 'return') then "quantity" > 0
                else "quantity" <> 0
            end`,
        ),
    ],
);
