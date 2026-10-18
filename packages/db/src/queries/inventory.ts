import { eq } from "drizzle-orm";
import { inventory, stockMovements } from "../schema";
import type { Db, Tx } from "../client";

export interface StockRow {
    variantId: string;
    onHand: number;
    reserved: number;
    available: number;
}

/** 取某变体库存（无行视为全 0）。available 来自 DB 生成列，非应用层计算。 */
export async function getStock(db: Db | Tx, variantId: string): Promise<StockRow> {
    const row = (await db.select().from(inventory).where(eq(inventory.variantId, variantId)).limit(1))[0];
    return row
        ? { variantId: row.variantId, onHand: row.onHand, reserved: row.reserved, available: row.available ?? 0 }
        : { variantId, onHand: 0, reserved: 0, available: 0 };
}

export interface SetOnHandInput {
    variantId: string;
    onHand: number; // 绝对值（目标库存）
    note?: string | null;
    changedBy?: string | null;
}

/**
 * 手动设置某变体 on_hand（绝对值）：upsert inventory + 追加一条 adjustment 库存流水（带符号增量）。
 * available 为 DB 生成列自动跟随；可售性读时现算，故无需发事件。
 */
export async function setVariantOnHand(db: Db | Tx, input: SetOnHandInput): Promise<{ delta: number }> {
    const current = (await db.select().from(inventory).where(eq(inventory.variantId, input.variantId)).limit(1))[0];
    const oldOnHand = current?.onHand ?? 0;
    const delta = input.onHand - oldOnHand;

    await db
        .insert(inventory)
        .values({ variantId: input.variantId, onHand: input.onHand, reserved: current?.reserved ?? 0 })
        .onConflictDoUpdate({ target: inventory.variantId, set: { onHand: input.onHand, updatedAt: new Date() } });

    if (delta !== 0) {
        await db.insert(stockMovements).values({
            variantId: input.variantId,
            type: "adjustment",
            quantity: delta,
            onHandAfter: input.onHand,
            referenceType: "adjustment",
            note: input.note ?? (input.changedBy ? `manual by ${input.changedBy}` : "manual adjustment"),
        });
    }
    return { delta };
}
