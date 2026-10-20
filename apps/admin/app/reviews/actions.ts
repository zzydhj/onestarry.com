"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@onestarry/core";
import { createDb, setReviewStatus, type ReviewStatus } from "@onestarry/db";
import { requirePermission } from "@/lib/auth";

const VALID: ReviewStatus[] = ["pending", "approved", "rejected", "flagged"];

/** 审核一条评论：改状态（需 product:write）。 */
export async function moderateReviewAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.productWrite);
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "") as ReviewStatus;
    if (!id || !VALID.includes(status)) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await setReviewStatus(db, id, status);
    revalidatePath("/reviews");
}
