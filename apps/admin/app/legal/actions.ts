"use server";

import { createDb, LEGAL_DOC_TYPES, upsertLegalDoc, type LegalDocType } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { queuePathsInvalidation } from "@/lib/invalidate";

/** 保存某法律文档正文（locale=en、市场级 NULL）。type 白名单校验。 */
export async function saveLegalDocAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.seoWrite);
    const type = String(formData.get("type") ?? "");
    const body = String(formData.get("body") ?? "");
    if (!(LEGAL_DOC_TYPES as readonly string[]).includes(type)) return;

    const db = createDb(env.HYPERDRIVE.connectionString);
    await upsertLegalDoc(db, { type: type as LegalDocType, locale: "en", body });
    // 前台 /legal/[type] 的 revalidate = 3600（一小时），没这条按需失效就要等整点——
    // 而隐私/退款这类文案改完“不立刻生效”是有合规代价的，所以这里比其他页更必需。
    queuePathsInvalidation({ ctx, paths: ["/legal", `/legal/${type}`] });
}
