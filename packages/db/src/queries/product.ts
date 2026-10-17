import { and, eq } from "drizzle-orm";
import { inventory, markets, productTranslations, productVariants, products, slugs, variantMarketPrices } from "../schema";
import type { Db, Tx } from "../client";

export interface CatalogListItem {
    productId: string;
    slug: string;
    title: string;
    description: string | null;
    priceCents: number;
    currency: string;
}

/** 某市场可售商品列表（active 商品 ⨝ 主变体 ⨝ 全包价缓存 ⨝ 文案 ⨝ 当前 slug）。 */
export async function listProductsForMarket(db: Db | Tx, marketCode: string, locale = "en"): Promise<CatalogListItem[]> {
    const market = (await db.select({ id: markets.id }).from(markets).where(eq(markets.code, marketCode)).limit(1))[0];
    if (!market) return [];

    return db
        .select({
            productId: products.id,
            slug: slugs.slug,
            title: productTranslations.title,
            description: productTranslations.description,
            priceCents: variantMarketPrices.listPriceCents,
            currency: variantMarketPrices.currency,
        })
        .from(products)
        .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isPrimary, true)))
        .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, market.id)))
        .innerJoin(productTranslations, and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, locale)))
        .innerJoin(slugs, and(eq(slugs.entityId, products.id), eq(slugs.entityType, "product"), eq(slugs.locale, locale), eq(slugs.isCurrent, true)))
        .where(eq(products.status, "active"));
}

export interface ProductDetail {
    productId: string;
    variantId: string;
    sku: string;
    title: string;
    description: string | null;
    priceCents: number;
    allInCents: number;
    currency: string;
    available: number;
}

/** 取某商品在指定市场的详情（含可售库存）。找不到返回 null。 */
export async function getProductById(db: Db | Tx, productId: string, marketCode: string, locale = "en"): Promise<ProductDetail | null> {
    const market = (await db.select({ id: markets.id }).from(markets).where(eq(markets.code, marketCode)).limit(1))[0];
    if (!market) return null;

    const row = (
        await db
            .select({
                productId: products.id,
                variantId: productVariants.id,
                sku: productVariants.sku,
                title: productTranslations.title,
                description: productTranslations.description,
                priceCents: variantMarketPrices.listPriceCents,
                allInCents: variantMarketPrices.allInCents,
                currency: variantMarketPrices.currency,
                available: inventory.available,
            })
            .from(products)
            .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isPrimary, true)))
            .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, market.id)))
            .innerJoin(productTranslations, and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, locale)))
            .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
            .where(eq(products.id, productId))
            .limit(1)
    )[0];
    if (!row) return null;
    return { ...row, available: row.available ?? 0 };
}
