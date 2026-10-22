import { sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "../client";
import type { SeoMetaRow } from "./seo";

/**
 * 类目页 / 品牌页的一次性取数。
 *
 * 为什么要有这个文件：这两类页原先各串 4–5 次跨洋往返（resolveSlug 命中历史 slug 时还要 2 次
 * → getCategoryById/getBrandById → getCategorySubtreeIds → getSeoMeta → browseProducts）。
 * 线上实测单次往返 ~150–250ms，串行叠加后冷渲染到 2.3–4.3 秒（docs/PERF.md §3；
 * 2026-10-22 用户报“从品牌/分类列表页跳进具体页很卡”就是这条路径）。
 * 这里把**除商品列表外**的全部小查询合成一条 SQL，页面总往返降到 2 次。
 * browseProducts 保持原样不并进来：它是列表的唯一真源（首页/搜索/类目/品牌共用），
 * 复制到这里会变成第二份价格/库存 join，改一处漏一处。
 */

/** 与 orders.ts 里的同名私有助手形状一致：参数绑定 + 显式 cast，绝不拼字符串。 */
const pTxt = (v: string | null | undefined): SQL => sql`${v ?? null}::text`;

export type CatalogPageStatus = "ok" | "redirect" | "notfound";

export interface CatalogPageMeta {
    status: CatalogPageStatus;
    /** status=redirect 时的当前 slug（历史 slug → 301）。 */
    toSlug?: string;
    /** status=ok 时的展示名。 */
    name?: string;
    entityId: string | null;
    /** 类目=以自身为根的子树全部 id（含自身）；品牌页恒为空数组。 */
    categoryIds: string[];
    seo: SeoMetaRow | null;
}

interface RawMeta {
    status: CatalogPageStatus;
    entityId: string | null;
    toSlug: string | null;
    name: string | null;
    ids: string[] | null;
    seo: SeoMetaRow | null;
}

function toMeta(d: RawMeta | undefined): CatalogPageMeta {
    if (!d) return { status: "notfound", entityId: null, categoryIds: [], seo: null };
    if (d.status !== "ok") {
        return { status: d.status, toSlug: d.toSlug ?? undefined, entityId: d.entityId ?? null, categoryIds: [], seo: null };
    }
    return {
        status: "ok",
        name: d.name ?? undefined,
        entityId: d.entityId ?? null,
        categoryIds: d.ids ?? [],
        seo: d.seo ?? null,
    };
}

/**
 * 两个函数里的 seo 子查询都是手写的：raw 查询不会替我们映射列名，
 * `to_jsonb(m)` 会返回 `seo_title` 这种真名，而 applySeoMeta 读的是 camelCase ——
 * 写成 to_jsonb 会让 SEO 覆盖静默失效（typecheck 过、页面不报错）。
 *
 * 类目页元数据：slug 解析 + 类目行 + 子树 id + SEO 覆盖，**一条 SQL**。
 * 三态与 resolveSlug 完全一致：查无 slug → notfound；命中历史 slug → redirect；当前 slug 但实体行没了 → notfound。
 */
export async function loadCategoryPageMeta(db: Db | Tx, q: { slug: string; locale?: string }): Promise<CatalogPageMeta> {
    const locale = q.locale ?? "en";
    const [row] = await db.execute<{ data: RawMeta }>(sql`
        with recursive res as (
            select s.entity_id, s.is_current
            from slugs s
            where s.entity_type = 'category' and s.locale = ${pTxt(locale)} and s.slug = ${pTxt(q.slug)}
            limit 1
        ),
        cur as (
            select s.slug as to_slug
            from res r
            join slugs s
              on s.entity_id = r.entity_id and s.entity_type = 'category' and s.locale = ${pTxt(locale)} and s.is_current
            where not r.is_current
        ),
        ent as (
            select c.id, c.name
            from categories c
            join res r on r.entity_id = c.id
        ),
        sub(id) as (
            select e.id from ent e
            union all
            select c.id from categories c join sub sb on c.parent_id = sb.id
        )
        cycle id set is_cycle to true default false using path
        select json_build_object(
            'status', case
                when not exists (select 1 from res) then 'notfound'
                when not (select is_current from res) then 'redirect'
                when not exists (select 1 from ent) then 'notfound'
                else 'ok' end,
            'entityId', (select id from ent limit 1),
            'toSlug', (select to_slug from cur limit 1),
            'name', (select name from ent limit 1),
            'ids', (select json_agg(id) from sub where not is_cycle),
            'seo', (
                select json_build_object(
                    'id', m.id, 'entityType', m.entity_type, 'entityId', m.entity_id, 'locale', m.locale,
                    'seoTitle', m.seo_title, 'metaDescription', m.meta_description, 'canonicalUrl', m.canonical_url,
                    'robots', m.robots, 'og', m.og
                )
                from seo_meta m
                join res r on r.entity_id = m.entity_id
                where m.entity_type = 'category' and m.locale = ${pTxt(locale)} and m.market_id is null
                limit 1
            )
        ) as data
    `);
    return toMeta(row?.data);
}

/** 品牌页元数据：同上一条，少一层子树（品牌不分层）。 */
export async function loadBrandPageMeta(db: Db | Tx, q: { slug: string; locale?: string }): Promise<CatalogPageMeta> {
    const locale = q.locale ?? "en";
    const [row] = await db.execute<{ data: RawMeta }>(sql`
        with res as (
            select s.entity_id, s.is_current
            from slugs s
            where s.entity_type = 'brand' and s.locale = ${pTxt(locale)} and s.slug = ${pTxt(q.slug)}
            limit 1
        ),
        cur as (
            select s.slug as to_slug
            from res r
            join slugs s
              on s.entity_id = r.entity_id and s.entity_type = 'brand' and s.locale = ${pTxt(locale)} and s.is_current
            where not r.is_current
        ),
        ent as (
            select b.id, b.name
            from brands b
            join res r on r.entity_id = b.id
        )
        select json_build_object(
            'status', case
                when not exists (select 1 from res) then 'notfound'
                when not (select is_current from res) then 'redirect'
                when not exists (select 1 from ent) then 'notfound'
                else 'ok' end,
            'entityId', (select id from ent limit 1),
            'toSlug', (select to_slug from cur limit 1),
            'name', (select name from ent limit 1),
            'ids', null::json,
            'seo', (
                select json_build_object(
                    'id', m.id, 'entityType', m.entity_type, 'entityId', m.entity_id, 'locale', m.locale,
                    'seoTitle', m.seo_title, 'metaDescription', m.meta_description, 'canonicalUrl', m.canonical_url,
                    'robots', m.robots, 'og', m.og
                )
                from seo_meta m
                join res r on r.entity_id = m.entity_id
                where m.entity_type = 'brand' and m.locale = ${pTxt(locale)} and m.market_id is null
                limit 1
            )
        ) as data
    `);
    return toMeta(row?.data);
}
