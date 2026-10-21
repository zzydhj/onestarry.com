"use server";

import { revalidatePath } from "next/cache";
import { createDb, LEGAL_DOC_TYPES, upsertLegalDoc, type LegalDocType } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";

/** 保存某法律文档正文（locale=en、市场级 NULL）。type 白名单校验。 */
export async function saveLegalDocAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.seoWrite);
    const type = String(formData.get("type") ?? "");
    const body = String(formData.get("body") ?? "");
    if (!(LEGAL_DOC_TYPES as readonly string[]).includes(type)) return;

    const db = createDb(env.HYPERDRIVE.connectionString);
    await upsertLegalDoc(db, { type: type as LegalDocType, locale: "en", body });
    revalidatePath("/legal");
}
