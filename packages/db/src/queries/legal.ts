import { and, asc, eq, isNull } from "drizzle-orm";
import { legalDocuments } from "../schema";
import type { Db, Tx } from "../client";

export const LEGAL_DOC_TYPES = ["terms", "privacy", "returns", "withdrawal"] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

/** 全部"当前版"法律文档（后台列表用）。 */
export async function listLegalDocs(db: Db | Tx) {
    return db
        .select({
            id: legalDocuments.id,
            type: legalDocuments.type,
            locale: legalDocuments.locale,
            version: legalDocuments.version,
            updatedAt: legalDocuments.updatedAt,
        })
        .from(legalDocuments)
        .where(and(eq(legalDocuments.isCurrent, true), isNull(legalDocuments.marketId)))
        .orderBy(asc(legalDocuments.type));
}

/** 取某类型当前版正文（前台渲染 / 后台编辑初值）。无则 null。 */
export async function getLegalDoc(
    db: Db | Tx,
    q: { type: string; locale: string },
): Promise<{ id: string; body: string; version: number } | null> {
    const row = (
        await db
            .select({ id: legalDocuments.id, body: legalDocuments.body, version: legalDocuments.version })
            .from(legalDocuments)
            .where(
                and(
                    eq(legalDocuments.type, q.type),
                    eq(legalDocuments.locale, q.locale),
                    eq(legalDocuments.isCurrent, true),
                    isNull(legalDocuments.marketId),
                ),
            )
            .limit(1)
    )[0];
    return row ?? null;
}

/**
 * 保存法律文档：有当前版则就地改正文；无则插 v1。
 * MVP 简化：不做"改一次生一版"的历史链（表已留 version/isCurrent 供将来扩展）；正文存纯文本，非 HTML。
 */
export async function upsertLegalDoc(
    db: Db | Tx,
    input: { type: LegalDocType; locale: string; body: string },
): Promise<void> {
    const existing = await getLegalDoc(db, { type: input.type, locale: input.locale });
    if (existing) {
        await db
            .update(legalDocuments)
            .set({ body: input.body, updatedAt: new Date() })
            .where(eq(legalDocuments.id, existing.id));
        return;
    }
    await db.insert(legalDocuments).values({
        type: input.type,
        locale: input.locale,
        marketId: null,
        version: 1,
        body: input.body,
        isCurrent: true,
    });
}
