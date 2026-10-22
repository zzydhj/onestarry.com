import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { brands, categories, inventory, markets, productTranslations, productVariants, products, slugs, variantMarketPrices } from "../schema";
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
 * 市场 id 内联子查询：旧写法先单独 `SELECT markets` 再查主行 = 多一次跨区往返。
 * 线上实测每多一条串行查询约 +0.4–0.9 秒（见 docs/PERF.md），所以列表/详情一律合成一条。
 */
function marketIdOf(db: Db | Tx, marketCode: string) {
    return db.select({ id: markets.id }).from(markets).where(eq(markets.code, marketCode)).limit(1);
}

/** 首图相关子查询（position 最小、同位按创建时间最早）：把原先独立一条的批量取图压进主查询。 */
const firstImageSql = sql<string | null>`(
    select ma.r2_key
    from product_images pi
    join media_assets ma on ma.id = pi.media_id
    where pi.product_id = ${products.id}
    order by pi.position asc, ma.created_at asc
    limit 1
)`;

/**
 * 可售商品浏览查询（列表单一真源）：active 商品 ⨝ 主变体 ⨝ 该市场全包价 ⨝ 文案 ⨝ 当前 slug，附首图。
 * 支持按类目子树 / 品牌过滤；**一条 SQL 同时拿到本页 items、匹配总数 total（窗口函数）与首图（相关子查询）**，
 * 旧写法是 market/行/计数/附图 4 次串行往返。按标题升序稳定排序。
 */
export async function browseProducts(db: Db | Tx, f: BrowseFilters): Promise<BrowseResult> {
    const locale = f.locale ?? "en";
    const marketId = marketIdOf(db, f.marketCode);

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
            imageUrl: firstImageSql,
            total: sql<number>`count(*) over ()::int`,
        })
        .from(products)
        .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isPrimary, true)))
        .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, sql`(${marketId})`)))
        .innerJoin(productTranslations, and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, locale)))
        .innerJoin(slugs, and(eq(slugs.entityId, products.id), eq(slugs.entityType, "product"), eq(slugs.locale, locale), eq(slugs.isCurrent, true)))
        .where(where)
        .orderBy(asc(productTranslations.title))
        .limit(f.limit ?? 100)
        .offset(f.offset ?? 0);

    // 窗口总数只在有行时可得；offset 越界时返回 0（当前调用方不分页，不会踩到）。
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export interface SearchFilters {
    marketCode: string;
    locale?: string;
    q: string;
    limit?: number;
    offset?: number;
}

/**
 * 站内搜索：对当前语言文案 title+description 做英文 FTS（websearch_to_tsquery，参数绑定、免注入），
 * 按 ts_rank 相关度降序。空查询短路返回空。
 * **market / 命中行 / 总数 / 首图 合成一条 SQL**（旧写法 4 次串行往返，线上该页实测 2.6–5.3 秒）。
 * 无 GIN 表达式索引（小规模目录够用）；量大时在迁移 SQL 里补 generated tsvector 列 + GIN。
 */
export async function searchProducts(db: Db | Tx, f: SearchFilters): Promise<BrowseResult> {
    const locale = f.locale ?? "en";
    const q = f.q.trim();
    if (!q) return { items: [], total: 0 };
    const marketId = marketIdOf(db, f.marketCode);

    const tsq = sql`websearch_to_tsquery('english', ${q})`;
    const match = sql`${productTranslations.searchVector} @@ ${tsq}`;

    const rows = await db
        .select({
            productId: products.id,
            slug: slugs.slug,
            title: productTranslations.title,
            description: productTranslations.description,
            priceCents: variantMarketPrices.listPriceCents,
            currency: variantMarketPrices.currency,
            imageUrl: firstImageSql,
            total: sql<number>`count(*) over ()::int`,
        })
        .from(products)
        .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isPrimary, true)))
        .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, sql`(${marketId})`)))
        .innerJoin(productTranslations, and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, locale)))
        .innerJoin(slugs, and(eq(slugs.entityId, products.id), eq(slugs.entityType, "product"), eq(slugs.locale, locale), eq(slugs.isCurrent, true)))
        .where(and(eq(products.status, "active"), match))
        .orderBy(sql`ts_rank(${productTranslations.searchVector}, ${tsq}) desc`, asc(productTranslations.title))
        .limit(f.limit ?? 60)
        .offset(f.offset ?? 0);

    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
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

/** 取某商品在指定市场的详情（含可售库存）。找不到返回 null。market 内联→只一次往返。 */
export async function getProductById(db: Db | Tx, productId: string, marketCode: string, locale = "en"): Promise<ProductDetail | null> {
    const marketId = marketIdOf(db, marketCode);

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
            .innerJoin(variantMarketPrices, and(eq(variantMarketPrices.variantId, productVariants.id), eq(variantMarketPrices.marketId, sql`(${marketId})`)))
            .innerJoin(productTranslations, and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, locale)))
            .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
            .where(eq(products.id, productId))
            .limit(1)
    )[0];
    if (!row) return null;
    return { ...row, available: row.available ?? 0, richBody: (row.richBody as Record<string, unknown> | null) ?? null };
}
