import { and, eq } from "drizzle-orm";
import { slugs } from "../schema";
import type { Db, Tx } from "../client";

/** 名称 → URL slug（小写、非字母数字转连字符、限长 80）。 */
export function slugify(s: string): string {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** 取某实体当前 slug（无则 null）。 */
export async function getEntitySlug(
    db: Db | Tx,
    q: { entityType: string; entityId: string; locale?: string },
): Promise<string | null> {
    const row = (
        await db
            .select({ slug: slugs.slug })
            .from(slugs)
            .where(
                and(
                    eq(slugs.entityType, q.entityType),
                    eq(slugs.entityId, q.entityId),
                    eq(slugs.locale, q.locale ?? "en"),
                    eq(slugs.isCurrent, true),
                ),
            )
            .limit(1)
    )[0];
    return row?.slug ?? null;
}

/** 在 (entityType, locale) 内求一个未被其它实体占用的 slug（冲突追加 -2/-3…）。 */
async function uniqueSlug(db: Db | Tx, entityType: string, locale: string, base: string, selfId: string): Promise<string> {
    let candidate = base;
    let n = 2;
    for (; ;) {
        const taken = (
            await db
                .select({ entityId: slugs.entityId })
                .from(slugs)
                .where(and(eq(slugs.entityType, entityType), eq(slugs.locale, locale), eq(slugs.slug, candidate)))
                .limit(1)
        )[0];
        if (!taken || taken.entityId === selfId) return candidate;
        candidate = `${base}-${n++}`;
    }
}

/**
 * 设实体 slug（单一真源）。与当前相同则不动；否则把当前行降为历史(isCurrent=false)、插入新当前行
 * （旧 slug 保留 → resolveSlug 自动 301）。返回最终 slug。
 */
export async function setEntitySlug(
    db: Db | Tx,
    input: { entityType: string; entityId: string; slug: string; locale?: string },
): Promise<string> {
    const locale = input.locale ?? "en";
    const desired = slugify(input.slug) || `s-${Date.now()}`;
    const cur = await getEntitySlug(db, { entityType: input.entityType, entityId: input.entityId, locale });
    if (cur === desired) return desired;
    const finalSlug = await uniqueSlug(db, input.entityType, locale, desired, input.entityId);
    if (cur) {
        await db
            .update(slugs)
            .set({ isCurrent: false, updatedAt: new Date() })
            .where(
                and(
                    eq(slugs.entityType, input.entityType),
                    eq(slugs.entityId, input.entityId),
                    eq(slugs.locale, locale),
                    eq(slugs.isCurrent, true),
                ),
            );
    }
    await db.insert(slugs).values({ entityType: input.entityType, entityId: input.entityId, locale, slug: finalSlug, isCurrent: true });
    return finalSlug;
}

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
