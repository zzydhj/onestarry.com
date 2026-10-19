import { and, eq } from "drizzle-orm";
import { slugs } from "../schema";
import type { Db, Tx } from "../client";

export interface SlugQuery {
    entityType: string;
    locale: string;
    slug: string;
}

export type SlugResolution =
    | { status: "current"; entityType: string; entityId: string; slug: string }
    /** 命中的是历史 slug → 返回当前 slug 供调用方 301。 */
    | { status: "redirect"; entityType: string; entityId: string; toSlug: string };

/**
 * slug 单一真源解析（§3.2）。命中历史 slug 时自动查出当前 slug，杜绝双源 404/重复 URL。
 * 未命中返回 null（调用方 404）。
 */
export async function resolveSlug(db: Db | Tx, q: SlugQuery): Promise<SlugResolution | null> {
    const hit = (
        await db
            .select()
            .from(slugs)
            .where(and(eq(slugs.entityType, q.entityType), eq(slugs.locale, q.locale), eq(slugs.slug, q.slug)))
            .limit(1)
    )[0];
    if (!hit) return null;

    if (hit.isCurrent) {
        return { status: "current", entityType: hit.entityType, entityId: hit.entityId, slug: hit.slug };
    }

    const current = (
        await db
            .select()
            .from(slugs)
            .where(
                and(
                    eq(slugs.entityType, hit.entityType),
                    eq(slugs.locale, hit.locale),
                    eq(slugs.entityId, hit.entityId),
                    eq(slugs.isCurrent, true),
                ),
            )
            .limit(1)
    )[0];
    return {
        status: "redirect",
        entityType: hit.entityType,
        entityId: hit.entityId,
        toSlug: current?.slug ?? hit.slug,
    };
}

/** 某实体类型的全部当前 en slug（sitemap 用：category / brand / product 通用）。 */
export async function listCurrentSlugs(db: Db | Tx, entityType: string): Promise<string[]> {
    const rows = await db
        .select({ slug: slugs.slug })
        .from(slugs)
        .where(and(eq(slugs.entityType, entityType), eq(slugs.locale, "en"), eq(slugs.isCurrent, true)));
    return rows.map((r) => r.slug);
}
