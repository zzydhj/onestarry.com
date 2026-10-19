import { and, asc, count, eq, inArray } from "drizzle-orm";
import { brands, categories, inventory, markets, mediaAssets, productImages, productTranslations, productVariants, products, slugs, variantMarketPrices } from "../schema";
import type { Db, Tx } from "../client";

/** 活跃商品的当前 en slug + 更新时间（sitemap 用）。 */
export async function listActiveProductSlugs(db: Db | Tx) {
    return db
        .select({ slug: slugs.slug, updatedAt: products.updatedAt })
        .from(products)
        .innerJoin(
            slugs,
            and(
                eq(slugs.entityId, products.id),
                eq(slugs.entityType, "product"),
                eq(slugs.locale, "en"),
                eq(slugs.isCurrent, true),
            ),
        )
        .where(eq(products.status, "active"))
        .orderBy(asc(slugs.slug));
}

export interface CatalogListItem {
    productId: string;
    slug: string;
    title: string;
    description: string | null;
    priceCents: number;
    currency: string;
    imageUrl: string | null;
}

export interface BrowseFilters {
    marketCode: string;
    locale?: string;
    categoryIds?: string[]; // 限定在这些类目（调用方已展开子树）
    brandId?: string;
    limit?: number;
    offset?: number;
}
export interface BrowseResult {
    items: CatalogListItem[];
    total: number;
}

/**
 * 可售商品浏览查询（列表单一真源）：active 商品 ⨝ 主变体 ⨝ 该市场全包价 ⨝ 文案 ⨝ 当前 slug，附首图。
 * 支持按类目子树 / 品牌过滤 + 分页；返回本页 items 与匹配总数 total。按标题升序稳定排序。
 */
export async function browseProducts(db: Db | Tx, f: BrowseFilters): Promise<BrowseResult> {
    const locale = f.locale ?? "en";
    const market = (await db.select({ id: markets.id }).from(markets).where(eq(markets.code, f.marketCode)).limit(1))[0];
    if (!market) return { items: [], total: 0 };

    const conds = [eq(products.status, "active")];
    if (f.categoryIds?.length) conds.push(inArray(products.primaryCategoryId, f.categoryIds));
    if (f.brandId) conds.push(eq(products.brandId, f.brandId));
    const where = and(...conds);

    const rows = await db
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
        .where(where)
        .orderBy(asc(productTranslations.title))
        .limit(f.limit ?? 100)
        .offset(f.offset ?? 0);

    const totalRow = await db
        .select({ c: count() })
        .from(products)
        .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isPrimary, true)))
        .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, market.id)))
        .where(where);
    const total = totalRow[0]?.c ?? 0;

    if (rows.length === 0) return { items: [], total };

    const imgRows = await db
        .select({ productId: productImages.productId, r2Key: mediaAssets.r2Key })
        .from(productImages)
        .innerJoin(mediaAssets, eq(productImages.mediaId, mediaAssets.id))
        .where(inArray(productImages.productId, rows.map((r) => r.productId)))
        .orderBy(asc(productImages.position), asc(mediaAssets.createdAt));
    const firstImg = new Map<string, string>();
    for (const r of imgRows) if (!firstImg.has(r.productId)) firstImg.set(r.productId, r.r2Key);

    return { items: rows.map((r) => ({ ...r, imageUrl: firstImg.get(r.productId) ?? null })), total };
}

/** 某市场全部可售商品（首页用；保持原签名，内部走 browseProducts）。 */
export async function listProductsForMarket(db: Db | Tx, marketCode: string, locale = "en"): Promise<CatalogListItem[]> {
    return (await browseProducts(db, { marketCode, locale, limit: 1000 })).items;
}

/** 类目子树 id（含自身），基于扁平 categories 表 BFS（暂不依赖 ltree）。 */
export async function getCategorySubtreeIds(db: Db | Tx, rootId: string): Promise<string[]> {
    const all = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
    const childrenOf = new Map<string, string[]>();
    for (const c of all) {
        const k = c.parentId ?? "";
        const arr = childrenOf.get(k);
        if (arr) arr.push(c.id);
        else childrenOf.set(k, [c.id]);
    }
    const out: string[] = [];
    const stack = [rootId];
    while (stack.length) {
        const id = stack.pop()!;
        out.push(id);
        for (const ch of childrenOf.get(id) ?? []) stack.push(ch);
    }
    return out;
}

/** 取类目基本信息（浏览页标题用）。 */
export async function getCategoryById(db: Db | Tx, id: string) {
    return (await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.id, id)).limit(1))[0] ?? null;
}

/** 取品牌基本信息。 */
export async function getBrandById(db: Db | Tx, id: string) {
    return (await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.id, id)).limit(1))[0] ?? null;
}

export interface ProductDetail {
    productId: string;
    variantId: string;
    sku: string;
    title: string;
    description: string | null;
    richBody: Record<string, unknown> | null;
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
                richBody: productTranslations.richBody,
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
    return { ...row, available: row.available ?? 0, richBody: (row.richBody as Record<string, unknown> | null) ?? null };
}
