"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";
import { createDb, createReview } from "@onestarry/db";

/** 客户提交评价（需登录）→ 写 pending → revalidate PDP → 回商品页。 */
export async function submitReviewAction(formData: FormData): Promise<void> {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createCustomerAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const productId = String(formData.get("productId") ?? "");
    const slug = String(formData.get("slug") ?? "");
    const rating = Number(formData.get("rating") ?? 0);
    const title = String(formData.get("title") ?? "").trim() || null;
    const body = String(formData.get("body") ?? "").trim() || null;
    if (!productId) redirect("/");

    const db = createDb(env.HYPERDRIVE.connectionString);
    await createReview(db, { productId, customerId: session.user.id, rating, title, body, locale: "en" });

    if (slug) revalidatePath(`/products/${slug}`);
    redirect(slug ? `/products/${slug}` : "/");
}
