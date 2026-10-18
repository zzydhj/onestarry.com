"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, products, setVariantOnHand, updateVariantBasePrice } from "@onestarry/db";
import { runRelayBatch, relayHandlers } from "@onestarry/jobs";

/**
 * 后台改某变体基价 → 事务内改 basePriceCents + 对所有市场发 price.recompute 事件；
 * 提交后 ctx.waitUntil(runRelayBatch) 即时派发重算（写时自派发，秒级生效；Cron 每分钟兜底）。
 */
export async function updateBasePriceAction(formData: FormData): Promise<void> {
    const { env, ctx } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const variantId = String(formData.get("variantId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    const cents = Math.round(parseFloat(String(formData.get("price") ?? "")) * 100);
    if (!variantId || !Number.isFinite(cents) || cents < 0) return; // 价格不合法：静默忽略

    const db = createDb(env.HYPERDRIVE.connectionString);
    await db.transaction(async (tx) => {
        await updateVariantBasePrice(tx, { variantId, basePriceCents: cents, changedBy: session.user!.id });
    });

    // 写时自派发：立即消费 outbox 重算价格缓存（与请求解耦，失败有 Cron 兜底）
    ctx.waitUntil(runRelayBatch(db, relayHandlers, { limit: 50 }));

    if (productId) revalidatePath(`/products/${productId}`);
}

const STATUSES = ["draft", "active", "archived"] as const;
type ProductStatus = (typeof STATUSES)[number];

/**
 * 上架/下架：改 products.status。可售性在读取时由 computeSellability 现算，
 * 故无需发事件——前台下次请求自动跟随（draft/archived 不可售）。
 */
export async function setProductStatusAction(formData: FormData): Promise<void> {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const productId = String(formData.get("productId") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!productId || !(STATUSES as readonly string[]).includes(status)) return;

    const db = createDb(env.HYPERDRIVE.connectionString);
    await db
        .update(products)
        .set({ status: status as ProductStatus, updatedAt: new Date() })
        .where(eq(products.id, productId));

    revalidatePath(`/products/${productId}`);
}

/**
 * 调整某变体库存（on_hand 绝对值）：事务内 upsert 库存 + 追加 adjustment 流水。
 * 可售性读时现算→前台下次请求自动跟随，无需发事件。
 */
export async function updateInventoryAction(formData: FormData): Promise<void> {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const variantId = String(formData.get("variantId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    const onHand = Number.parseInt(String(formData.get("onHand") ?? ""), 10);
    if (!variantId || !Number.isInteger(onHand) || onHand < 0) return;

    const db = createDb(env.HYPERDRIVE.connectionString);
    await db.transaction(async (tx) => {
        await setVariantOnHand(tx, { variantId, onHand, changedBy: session.user!.id });
    });

    if (productId) revalidatePath(`/products/${productId}`);
}
