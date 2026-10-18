"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, createProductWithVariant } from "@onestarry/db";
import { runRelayBatch, relayHandlers } from "@onestarry/jobs";

function slugify(s: string): string {
    return s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

/** 新建最小可售卖商品（product+主变体+库存+slug+文案+发重算事件）→ 即时算价 → 跳详情。 */
export async function createProductAction(formData: FormData): Promise<void> {
    const { env, ctx } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const sku = String(formData.get("sku") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const slug = slugify(String(formData.get("slug") ?? "").trim() || title);
    const cents = Math.round(parseFloat(String(formData.get("price") ?? "")) * 100);
    const costRaw = String(formData.get("cost") ?? "").trim();
    const costCents = costRaw && Number.isFinite(parseFloat(costRaw)) ? Math.round(parseFloat(costRaw) * 100) : null;
    const weightRaw = String(formData.get("weight") ?? "").trim();
    const weightG = weightRaw ? Number.parseInt(weightRaw, 10) : null;
    const onHand = Number.parseInt(String(formData.get("onHand") ?? "0"), 10) || 0;
    const status = String(formData.get("status") ?? "draft") === "active" ? "active" : "draft";

    let target = "/products/new?error=invalid";
    if (sku && title && slug && Number.isFinite(cents) && cents >= 0) {
        const db = createDb(env.HYPERDRIVE.connectionString);
        try {
            const res = await db.transaction(async (tx) =>
                createProductWithVariant(tx, {
                    sku,
                    slug,
                    title,
                    description,
                    basePriceCents: cents,
                    costCents,
                    weightG,
                    onHand,
                    status,
                    changedBy: session.user!.id,
                }),
            );
            ctx.waitUntil(runRelayBatch(db, relayHandlers, { limit: 50 }));
            target = `/products/${res.productId}`;
        } catch {
            target = "/products/new?error=duplicate"; // sku 或 slug 唯一冲突
        }
    }
    redirect(target);
}
