"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { mediaUrl } from "@onestarry/core";
import { createDb, attachProductImage, deleteProductImage, moveProductImage, products, setProductRichBody, setVariantOnHand, updateVariantBasePrice, upsertSeoMeta } from "@onestarry/db";
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

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB 上限（前端已压图，服务端双保险）

/** 上传一张商品图：校验 → 存 R2（按 §10.3 key）→ 登记 media_assets + product_images。 */
export async function uploadProductImageAction(formData: FormData): Promise<void> {
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
    const file = formData.get("image");
    if (!productId || !(file instanceof File) || file.size === 0) return;
    const type = file.type;
    if (!type.startsWith("image/") || file.size > MAX_UPLOAD_BYTES) return;

    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg";
    const key = `products/${productId}/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();
    await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
    });

    const db = createDb(env.HYPERDRIVE.connectionString);
    await attachProductImage(db, { productId, r2Key: key, mimeType: type, sizeBytes: file.size });

    revalidatePath(`/products/${productId}`);
}

/** 保存图文详情（前端 Tiptap 传 JSON 字符串）→ 写 product_translations.rich_body。 */
export async function saveRichBodyAction(formData: FormData): Promise<void> {
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
    const raw = String(formData.get("body") ?? "");
    if (!productId) return;
    let parsed: Record<string, unknown> | null = null;
    try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
        return; // JSON 不合法：忽略
    }

    const db = createDb(env.HYPERDRIVE.connectionString);
    await setProductRichBody(db, { productId, richBody: parsed });

    revalidatePath(`/products/${productId}`);
}

/** 富文本内插图：上传到 R2（products/{id}/content/…）→ 返回可访问 URL，供编辑器插入。 */
export async function uploadRichImageAction(formData: FormData): Promise<{ url: string; error?: string }> {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) return { url: "", error: "未登录" };

    const productId = String(formData.get("productId") ?? "");
    const file = formData.get("image");
    if (!productId || !(file instanceof File) || file.size === 0) return { url: "", error: "无效文件" };
    const type = file.type;
    if (!type.startsWith("image/") || file.size > MAX_UPLOAD_BYTES) return { url: "", error: "图片类型或大小不符" };

    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg";
    const key = `products/${productId}/content/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();
    await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
    });
    return { url: mediaUrl(key) };
}

/** 删除一张商品图：解除关联 + 删 media_assets + 尽力删 R2 对象。 */
export async function deleteProductImageAction(formData: FormData): Promise<void> {
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
    const mediaId = String(formData.get("mediaId") ?? "");
    if (!productId || !mediaId) return;

    const db = createDb(env.HYPERDRIVE.connectionString);
    const { r2Key } = await deleteProductImage(db, { productId, mediaId });
    if (r2Key) {
        try {
            await env.MEDIA.delete(r2Key);
        } catch {
            // 忽略：DB 已解除关联，孤儿对象可后续清理
        }
    }
    revalidatePath(`/products/${productId}`);
}

/** 上移/下移一张商品图。 */
export async function moveProductImageAction(formData: FormData): Promise<void> {
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
    const mediaId = String(formData.get("mediaId") ?? "");
    const dir = String(formData.get("dir") ?? "") === "up" ? "up" : "down";
    if (!productId || !mediaId) return;

    const db = createDb(env.HYPERDRIVE.connectionString);
    await moveProductImage(db, { productId, mediaId, dir });
    revalidatePath(`/products/${productId}`);
}

/** 保存商品 SEO 覆盖（写 seo_meta，locale=en、市场级 NULL）；全空则删除→前台回退自动生成。 */
export async function saveSeoMetaAction(formData: FormData): Promise<void> {
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
    if (!productId) return;
    const noindex = formData.get("noindex") === "on";

    const db = createDb(env.HYPERDRIVE.connectionString);
    await upsertSeoMeta(db, {
        entityType: "product",
        entityId: productId,
        locale: "en",
        seoTitle: String(formData.get("seoTitle") ?? "") || null,
        metaDescription: String(formData.get("metaDescription") ?? "") || null,
        canonicalUrl: String(formData.get("canonicalUrl") ?? "") || null,
        robots: noindex ? { index: false } : null,
        og: null,
    });

    revalidatePath(`/products/${productId}`);
}
