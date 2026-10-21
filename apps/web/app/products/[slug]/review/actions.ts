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
    await createReview(db, { productId, customerId: session.userId, rating, title, body, locale: "en" });

    if (slug) revalidatePath(`/products/${slug}`);
    redirect(slug ? `/products/${slug}` : "/");
}
