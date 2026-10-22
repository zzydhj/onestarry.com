"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@onestarry/core";
import { createDb, setReviewStatus, type ReviewStatus } from "@onestarry/db";
import { requirePermission } from "@/lib/auth";
import { queueProductInvalidation } from "@/lib/invalidate";

const VALID: ReviewStatus[] = ["pending", "approved", "rejected", "flagged"];

/** 审核一条评论：改状态（需 product:write）。 */
export async function moderateReviewAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "") as ReviewStatus;
    if (!id || !VALID.includes(status)) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const productId = await setReviewStatus(db, id, status);
    // 评论是 PDP 的一部分（列表 + 平均分）：审核完要把**前台**那件商品的页失效。
    // 以前这里只 revalidatePath("/reviews")（后台自己的列表），前台等 60 秒定时器。
    queueProductInvalidation({ ctx, db, productId: productId ?? "" });
    revalidatePath("/reviews");
}
