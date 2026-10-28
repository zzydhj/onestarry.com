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
 * upsert 语言级 SEO 覆盖（marketId=NULL）。若所有覆盖字段皆空 → 删除该行（前台回退自动生成）。
 *
 * 审查 M-10：旧写法“先查后插”靠唯一索引，但 market_id 可空使 NULL 不唯一 → 并发保存两个都查不到 → 各插一行。
 * 现依 schema 的 COALESCE 表达式唯一索引强制单行；并发里后到的一方会撞 23505 → 重试为按 scope 更新（重放冲突重查）。
 * 唯一调用方（admin SEO 面板）是 Db 自提交、不包事务 → 23505 不会 abort 外部事务，重查安全。
 */
export async function upsertSeoMeta(
    db: Db | Tx,
    input: { entityType: string; entityId: string; locale: string } & SeoFields,
): Promise<void> {
    const scope = and(
        eq(seoMeta.entityType, input.entityType),
        eq(seoMeta.entityId, input.entityId),
        eq(seoMeta.locale, input.locale),
        isNull(seoMeta.marketId),
    );

    if (allEmpty(input)) {
        await db.delete(seoMeta).where(scope);
        return;
    }

    const fields: SeoFields = {
        seoTitle: input.seoTitle?.trim() || null,
        metaDescription: input.metaDescription?.trim() || null,
        canonicalUrl: input.canonicalUrl?.trim() || null,
        robots: input.robots ?? null,
        og: input.og ?? null,
    };

    const set = { ...fields, updatedAt: new Date() };
    const existing = (await db.select({ id: seoMeta.id }).from(seoMeta).where(scope).limit(1))[0];
    if (existing) {
        await db.update(seoMeta).set(set).where(eq(seoMeta.id, existing.id));
        return;
    }
    try {
        await db.insert(seoMeta).values({ entityType: input.entityType, entityId: input.entityId, locale: input.locale, marketId: null, ...fields });
    } catch (e) {
        // 并发对手刚插了同 scope 的 NULL 行（现由 COALESCE 表达式唯一索引拒绝）→ 退化成更新，不报错也不留双行。
        const anyErr = e as { code?: string; cause?: { code?: string } };
        const code = anyErr.code ?? anyErr.cause?.code;
        if (code === "23505") {
            await db.update(seoMeta).set(set).where(scope);
            return;
        }
        throw e;
    }
}
