"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb, createReview } from "@onestarry/db";
import { readCustomerSession } from "@/lib/session";

/** 客户提交评价（需登录）→ 写 pending → revalidate PDP → 回商品页。 */
export async function submitReviewAction(formData: FormData): Promise<void> {
    const session = await readCustomerSession();
    if (!session) redirect("/signin");

    const productId = String(formData.get("productId") ?? "");
    const slug = String(formData.get("slug") ?? "");
    const rating = Number(formData.get("rating") ?? 0);
    const title = String(formData.get("title") ?? "").trim() || null;
    const body = String(formData.get("body") ?? "").trim() || null;
    if (!productId) redirect("/");

    const db = createDb(session.env.HYPERDRIVE.connectionString);
    const res = await createReview(db, { productId, customerId: session.userId, rating, title, body, locale: "en" });
    // 审查 M-6：createReview 用返回值 `{error}` 报告非法评分（不抛错），旧写法直接丢弃它就 redirect 去 PDP → 变相“假装成功”。
    // 当前表单 rating 恒 1–5、正常不会触发；但既然有错误通道就不能谎报完成——退回本页并带标记，页上给一行提示。
    // 退回地址固定在 `/review/` 前缀下（审查 M2 搬迁后的真路径）：前导段还在，slug 里塞 `//host` 也不会变成协议相对跳转。
    if ("error" in res) {
        redirect(slug ? `/review/${slug}?error=${encodeURIComponent(res.error)}` : "/");
    }

    if (slug) revalidatePath(`/products/${slug}`);
    redirect(slug ? `/products/${slug}` : "/");
}
