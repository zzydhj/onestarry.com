import { and, eq, isNull } from "drizzle-orm";
import { seoMeta } from "../schema";
import type { Db, Tx } from "../client";

/** seo_meta 的覆盖字段（稀疏：只存被改的，其余 null → 前台回退默认）。 */
export interface SeoFields {
    seoTitle: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
    robots: Record<string, unknown> | null;
    og: Record<string, unknown> | null;
}

export interface SeoMetaRow extends SeoFields {
    id: string;
    entityType: string;
    entityId: string;
    locale: string;
}

/**
 * 取某实体的 SEO 覆盖（回退链：(locale, marketId) → (locale, NULL market)）。无覆盖返回 null。
 * 目前面板只写语言级（marketId=NULL），marketId 参数为将来市场级覆盖预留。
 */
export async function getSeoMeta(
    db: Db | Tx,
    q: { entityType: string; entityId: string; locale: string; marketId?: string },
): Promise<SeoMetaRow | null> {
    if (q.marketId) {
        const mkt = (
            await db
                .select()
                .from(seoMeta)
                .where(
                    and(
                        eq(seoMeta.entityType, q.entityType),
                        eq(seoMeta.entityId, q.entityId),
                        eq(seoMeta.locale, q.locale),
                        eq(seoMeta.marketId, q.marketId),
                    ),
                )
                .limit(1)
        )[0];
        if (mkt) return mkt as unknown as SeoMetaRow;
    }
    const base = (
        await db
            .select()
            .from(seoMeta)
            .where(
                and(
                    eq(seoMeta.entityType, q.entityType),
                    eq(seoMeta.entityId, q.entityId),
                    eq(seoMeta.locale, q.locale),
                    isNull(seoMeta.marketId),
                ),
            )
            .limit(1)
    )[0];
    return base ? (base as unknown as SeoMetaRow) : null;
}

/** 全空判断（用于"清空即回退默认"）。 */
function allEmpty(f: SeoFields): boolean {
    return !f.seoTitle?.trim() && !f.metaDescription?.trim() && !f.canonicalUrl?.trim() && !f.robots && !f.og;
}

/**
 * upsert 语言级 SEO 覆盖（marketId=NULL）。唯一索引含可空 marketId，ON CONFLICT 对 NULL 不可靠，
 * 故用"查在则改、不在则插"。若所有覆盖字段皆空 → 删除该行（前台回退自动生成）。
 */
export async function upsertSeoMeta(
    db: Db | Tx,
    input: { entityType: string; entityId: string; locale: string } & SeoFields,
): Promise<void> {
    const existing = (
        await db
            .select({ id: seoMeta.id })
            .from(seoMeta)
            .where(
                and(
                    eq(seoMeta.entityType, input.entityType),
                    eq(seoMeta.entityId, input.entityId),
                    eq(seoMeta.locale, input.locale),
                    isNull(seoMeta.marketId),
                ),
            )
            .limit(1)
    )[0];

    if (allEmpty(input)) {
        if (existing) await db.delete(seoMeta).where(eq(seoMeta.id, existing.id));
        return;
    }

    const fields: SeoFields = {
        seoTitle: input.seoTitle?.trim() || null,
        metaDescription: input.metaDescription?.trim() || null,
        canonicalUrl: input.canonicalUrl?.trim() || null,
        robots: input.robots ?? null,
        og: input.og ?? null,
    };

    if (existing) {
        await db.update(seoMeta).set({ ...fields, updatedAt: new Date() }).where(eq(seoMeta.id, existing.id));
    } else {
        await db.insert(seoMeta).values({
            entityType: input.entityType,
            entityId: input.entityId,
            locale: input.locale,
            marketId: null,
            ...fields,
        });
    }
}
