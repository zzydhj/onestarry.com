import { and, eq, inArray, sql } from "drizzle-orm";
import { inventory, markets, productTranslations, productVariants, variantMarketPrices } from "../schema";
import type { Db, Tx } from "../client";

export interface CartLine {
    variantId: string;
    sku: string;
    title: string;
    currency: string;
    unitCents: number; // 货值（不含运费）
    allInCents: number; // 全包单价
    available: number;
    blocked: boolean;
}

/** 按变体 id 批量取购物车行（含价格缓存/库存/文案）；市场不可用或无价则该行缺失。 */
export async function getCartLines(
    db: Db | Tx,
    variantIds: string[],
    marketCode: string,
    locale = "en",
): Promise<CartLine[]> {
    if (variantIds.length === 0) return [];
    // market 查找内联成子查询：旧写法先单独 SELECT markets 再查行 = 2 次跨区往返，
    // 合成 1 条后只要一次（结账页是用户“准备付钱”那一步，每省一个往返都是转化率）。
    const marketId = db
        .select({ id: markets.id })
        .from(markets)
        .where(eq(markets.code, marketCode))
        .limit(1);

    const rows = await db
        .select({
            variantId: productVariants.id,
            sku: productVariants.sku,
            title: productTranslations.title,
            currency: variantMarketPrices.currency,
            unitCents: variantMarketPrices.goodsCents,
            allInCents: variantMarketPrices.allInCents,
            available: inventory.available,
            blocked: variantMarketPrices.blocked,
        })
        .from(productVariants)
        .innerJoin(productTranslations, and(eq(productTranslations.productId, productVariants.productId), eq(productTranslations.locale, locale)))
        .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, sql`(${marketId})`)))
        .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
        .where(inArray(productVariants.id, variantIds));

    return rows.map((r) => ({ ...r, available: r.available ?? 0 }));
}
