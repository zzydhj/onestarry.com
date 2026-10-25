import { sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "../client";
import type { SeoMetaRow } from "./seo";

/**
 * 后台商品详情页的一次性取数。
 *
 * 为什么要这个文件：`apps/admin/app/products/[id]/page.tsx` 原先串行 8 次查库
 * （products → translations → variants → inventory → images → seo → 全部类目 → 全部品牌），
 * 每趟都是跨洋往返（主库 us-east-2、边缘 HK，实测单趟 ~150–250ms），叠加冷连接后
 * 用户实测「从列表点进详情要 6 秒」。
 *
 * ⚠ 这里**不能**靠 Promise.all 解决：本站实测同一个 `max:1` 连接里并行不省时间
 * （1511ms vs 1531ms，它们排队）。唯一有效的手法是合成一条 SQL —— 与
 * `catalogPage.ts` 同一个路子（那次 2256–4640ms → 999–1280ms）。
 *
 * 两个已知坑照旧避开（都是踩过的位置）：
 *  · 列名必须**显式写成 camelCase 键**：`to_jsonb(t)` 会返回 `base_price_cents` 这种真名，
 *    raw 查询不替我们映射，写成 to_jsonb 会让页面静默拿到 undefined。
 *  · 金额列是 `bigint(mode:"number")`，在 json_build_object 里出来是 **JSON number**；
 *    而裸 select 出来的 bigint 是 string —— 两种形态别混用，这里统一按 number 收。
 */

const pId = (v: string): SQL => sql`${v}::uuid`;

export interface AdminVariantRow {
    id: string;
    sku: string;
    basePriceCents: number | null;
    costCents: number | null;
    isPrimary: boolean;
    onHand: number;
    available: number;
}

export interface AdminImageRow {
    mediaId: string;
    r2Key: string;
    mimeType: string | null;
    position: number;
}

/** 类目下拉项：level 必有（页面用它做缩进），所以定成必填而不是可选 —— 可选会把责任推给调用方去写 ??。 */
export interface AdminCategoryOption {
    id: string;
    name: string;
    level: number;
}

/** 品牌下拉项（品牌不分层，无 level）。 */
export interface AdminBrandOption {
    id: string;
    name: string;
}

export interface AdminProductDetail {
    found: boolean;
    id: string | null;
    status: string | null;
    brandId: string | null;
    primaryCategoryId: string | null;
    title: string | null;
    richBody: unknown;
    variants: AdminVariantRow[];
    images: AdminImageRow[];
    seo: SeoMetaRow | null;
    categories: AdminCategoryOption[];
    brands: AdminBrandOption[];
}

interface RawDetail extends Omit<AdminProductDetail, "variants" | "images" | "categories" | "brands" | "seo"> {
    variants: AdminVariantRow[] | null;
    images: AdminImageRow[] | null;
    categories: AdminCategoryOption[] | null;
    brands: AdminBrandOption[] | null;
    seo: SeoMetaRow | null;
}

const EMPTY: AdminProductDetail = {
    found: false,
    id: null,
    status: null,
    brandId: null,
    primaryCategoryId: null,
    title: null,
    richBody: null,
    variants: [],
    images: [],
    seo: null,
    categories: [],
    brands: [],
};

/**
 * 一条 SQL 取回详情页要的全部数据。查无此商品时返回 `{ found: false }`（不抛错，由页面 notFound()）。
 *
 * 与原先逐项查询的两处**有意**差异（都不是等价改写，写清楚免得日后被当成回归）：
 *  1. 译文原先 `limit(1)` 不带 locale 也不带 order by → 多语种时取哪一条不确定。
 *     这里固定优先 en、其次按 locale 名排序（与 SEO 面板只看 en 一致）。
 *  2. 变体原先无排序。这里定为「主变体在前、SKU 升序」，让每次打开的行序稳定。
 */
export async function loadAdminProductDetail(db: Db | Tx, productId: string): Promise<AdminProductDetail> {
    const [row] = await db.execute<{ data: RawDetail }>(sql`
        with prod as (
            select p.id, p.status, p.brand_id, p.primary_category_id
            from products p
            where p.id = ${pId(productId)}
            limit 1
        ),
        tr as (
            select t.title, t.rich_body
            from product_translations t
            join prod pr on pr.id = t.product_id
            order by (t.locale = 'en') desc, t.locale
            limit 1
        ),
        var as (
            select
                json_build_object(
                    'id', v.id, 'sku', v.sku,
                    'basePriceCents', v.base_price_cents, 'costCents', v.cost_cents,
                    'isPrimary', v.is_primary,
                    'onHand', coalesce(i.on_hand, 0), 'available', coalesce(i.available, 0)
                ) as o,
                row_number() over (order by v.is_primary desc, v.sku) as rn
            from product_variants v
            join prod pr on pr.id = v.product_id
            left join inventory i on i.variant_id = v.id
        ),
        img as (
            select
                json_build_object(
                    'mediaId', pi.media_id, 'r2Key', ma.r2_key,
                    'mimeType', ma.mime_type, 'position', pi.position
                ) as o,
                row_number() over (order by pi.position, ma.created_at) as rn
            from product_images pi
            join media_assets ma on ma.id = pi.media_id
            join prod pr on pr.id = pi.product_id
        )
        select json_build_object(
            'found', exists (select 1 from prod),
            'id', (select id from prod),
            'status', (select status from prod),
            'brandId', (select brand_id from prod),
            'primaryCategoryId', (select primary_category_id from prod),
            'title', (select title from tr),
            'richBody', (select rich_body from tr),
            'variants', (select coalesce(json_agg(o order by rn), '[]'::json) from var),
            'images', (select coalesce(json_agg(o order by rn), '[]'::json) from img),
            'seo', (
                select json_build_object(
                    'id', m.id, 'entityType', m.entity_type, 'entityId', m.entity_id, 'locale', m.locale,
                    'seoTitle', m.seo_title, 'metaDescription', m.meta_description, 'canonicalUrl', m.canonical_url,
                    'robots', m.robots, 'og', m.og
                )
                from seo_meta m
                join prod pr on pr.id = m.entity_id
                where m.entity_type = 'product' and m.locale = 'en' and m.market_id is null
                limit 1
            ),
            'categories', (
                select coalesce(
                    json_agg(json_build_object('id', c.id, 'name', c.name, 'level', c.level) order by c.level, c.name),
                    '[]'::json
                )
                from categories c
            ),
            'brands', (
                select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::json)
                from brands b
            )
        ) as data
    `);

    const d = row?.data;
    if (!d) return EMPTY;
    return {
        found: Boolean(d.found),
        id: d.id ?? null,
        status: d.status ?? null,
        brandId: d.brandId ?? null,
        primaryCategoryId: d.primaryCategoryId ?? null,
        title: d.title ?? null,
        richBody: d.richBody ?? null,
        variants: d.variants ?? [],
        images: d.images ?? [],
        seo: d.seo ?? null,
        categories: d.categories ?? [],
        brands: d.brands ?? [],
    };
}
