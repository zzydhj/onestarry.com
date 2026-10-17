import { eq } from "drizzle-orm";
import { inventory } from "../schema";
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
