import { and, asc, eq } from "drizzle-orm";
import { brands, slugs } from "../schema";
import { setEntitySlug } from "./slug";
import type { Db, Tx } from "../client";

export interface BrandRow {
    id: string;
    name: string;
    slug: string | null;
}

/** 全部品牌 + 当前 en slug（slugs 表为准，回落 brands.slug 列）。后台列表用。 */
export async function listAllBrands(db: Db | Tx): Promise<BrandRow[]> {
    const rows = await db
        .select({
            id: brands.id,
            name: brands.name,
            colSlug: brands.slug,
            urlSlug: slugs.slug,
        })
        .from(brands)
        .leftJoin(
            slugs,
            and(
                eq(slugs.entityId, brands.id),
                eq(slugs.entityType, "brand"),
                eq(slugs.locale, "en"),
                eq(slugs.isCurrent, true),
            ),
        )
        .orderBy(asc(brands.name));
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.urlSlug ?? r.colSlug ?? null }));
}

/**
 * 新建品牌：插 brands + 写 slugs 表（slug 缺省由 name 派生，前台 /brands/[slug] 可达），
 * 并把 brands.slug 反范式列同步为最终 slug。
 */
export async function createBrand(
    db: Db | Tx,
    input: { name: string; slug?: string; locale?: string },
): Promise<{ id: string; slug: string }> {
    const [row] = await db.insert(brands).values({ name: input.name }).returning({ id: brands.id });
    const slug = await setEntitySlug(db, {
        entityType: "brand",
        entityId: row!.id,
        slug: input.slug || input.name,
        locale: input.locale,
    });
    await db.update(brands).set({ slug, updatedAt: new Date() }).where(eq(brands.id, row!.id));
    return { id: row!.id, slug };
}

/**
 * 更新品牌名 + slug。slug 为空则只改名（保留当前 slug）；非空则经 setEntitySlug
 * （与当前不同才动，旧 slug 降历史 → resolveSlug → 前台永久重定向 308），并同步 brands.slug 列。返回最终 slug 或 null。
 */
export async function updateBrand(
    db: Db | Tx,
    input: { id: string; name: string; slug?: string; locale?: string },
): Promise<string | null> {
    await db.update(brands).set({ name: input.name, updatedAt: new Date() }).where(eq(brands.id, input.id));
    if (!input.slug) return null;
    const slug = await setEntitySlug(db, { entityType: "brand", entityId: input.id, slug: input.slug, locale: input.locale });
    await db.update(brands).set({ slug, updatedAt: new Date() }).where(eq(brands.id, input.id));
    return slug;
}
