"use server";

import { eq } from "drizzle-orm";
import { acceptedImageType, mediaUrl, PERMISSIONS } from "@onestarry/core";
import { isUuid } from "@/lib/ids";
import { attachProductImage, deleteProductImage, moveProductImage, products, setProductCatalog, setProductRichBody, setVariantOnHand, updateVariantBasePrice, upsertSeoMeta } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { runRelayBatch, relayHandlers } from "@onestarry/jobs";
import { requirePermission } from "@/lib/auth";
import { queueCatalogInvalidation, queueProductInvalidation } from "@/lib/invalidate";

/**
 * 后台改某变体基价 → 事务内改 basePriceCents + 对所有市场发 price.recompute 事件；
 * 提交后 ctx.waitUntil(runRelayBatch) 即时派发重算（写时自派发，秒级生效；Cron 每分钟兜底）。
 */
export async function updateBasePriceAction(formData: FormData): Promise<void> {
    const { env, ctx, userId } = await requirePermission(PERMISSIONS.productWrite);

    const variantId = String(formData.get("variantId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    const cents = Math.round(parseFloat(String(formData.get("price") ?? "")) * 100);
    if (!variantId || !Number.isFinite(cents) || cents < 0) return; // 价格不合法：静默忽略

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await db.transaction(async (tx) => {
        await updateVariantBasePrice(tx, { variantId, basePriceCents: cents, changedBy: userId });
    });

    // 写时自派发：立即消费 outbox 重算价格缓存（与请求解耦，失败有 Cron 兜底）
    ctx.waitUntil(runRelayBatch(db, relayHandlers, { limit: 50 }));

    queueProductInvalidation({ ctx, db, productId });
}

const STATUSES = ["draft", "active", "archived"] as const;
type ProductStatus = (typeof STATUSES)[number];

/**
 * 上架/下架：改 products.status。可售性在读取时由 computeSellability 现算，
 * 故无需发事件——前台下次请求自动跟随（draft/archived 不可售）。
 */
export async function setProductStatusAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!productId || !(STATUSES as readonly string[]).includes(status)) return;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await db
        .update(products)
        .set({ status: status as ProductStatus, updatedAt: new Date() })
        .where(eq(products.id, productId));

    queueProductInvalidation({ ctx, db, productId });
}

/**
 * 调整某变体库存（on_hand 绝对值）：事务内 upsert 库存 + 追加 adjustment 流水。
 * 可售性读时现算→前台下次请求自动跟随，无需发事件。
 */
export async function updateInventoryAction(formData: FormData): Promise<void> {
    const { env, ctx, userId } = await requirePermission(PERMISSIONS.productWrite);

    const variantId = String(formData.get("variantId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    const onHand = Number.parseInt(String(formData.get("onHand") ?? ""), 10);
    if (!variantId || !Number.isInteger(onHand) || onHand < 0) return;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await db.transaction(async (tx) => {
        await setVariantOnHand(tx, { variantId, onHand, changedBy: userId });
    });

    queueProductInvalidation({ ctx, db, productId });
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB 上限（前端已压图，服务端双保险）

/** 上传一张商品图：校验 → 存 R2（按 §10.3 key）→ 登记 media_assets + product_images。 */
export async function uploadProductImageAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    const file = formData.get("image");
    if (!isUuid(productId) || !(file instanceof File) || file.size === 0) return;
    // MIME 走 core 的显式白名单：旧写法 startsWith("image/") 会放行 image/svg+xml，
    // 而 SVG 能带脚本 —— 存进 R2 后从 media 子域直接打开就是“在自家域名上执行脚本”的钓鱼位。
    const img = acceptedImageType(file.type);
    if (!img || file.size > MAX_UPLOAD_BYTES) return;

    const key = `products/${productId}/${crypto.randomUUID()}.${img.ext}`;
    const bytes = await file.arrayBuffer();
    await env.MEDIA.put(key, bytes, {
        // 存归一化后的 contentType，不把客户端给的原始值写进对象存储。
        httpMetadata: { contentType: img.contentType, cacheControl: "public, max-age=31536000, immutable" },
    });

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await attachProductImage(db, { productId, r2Key: key, mimeType: img.contentType, sizeBytes: file.size });

    queueProductInvalidation({ ctx, db, productId });
}

/** 保存图文详情（前端 Tiptap 传 JSON 字符串）→ 写 product_translations.rich_body。 */
export async function saveRichBodyAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    const raw = String(formData.get("body") ?? "");
    if (!productId) return;
    let parsed: Record<string, unknown> | null = null;
    try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
        return; // JSON 不合法：忽略
    }

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await setProductRichBody(db, { productId, richBody: parsed });

    queueProductInvalidation({ ctx, db, productId });
}

/** 富文本内插图：上传到 R2（products/{id}/content/…）→ 返回可访问 URL，供编辑器插入。 */
export async function uploadRichImageAction(formData: FormData): Promise<{ url: string; error?: string }> {
    const { env } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    const file = formData.get("image");
    if (!isUuid(productId) || !(file instanceof File) || file.size === 0) return { url: "", error: "无效文件" };
    const img = acceptedImageType(file.type);
    if (!img || file.size > MAX_UPLOAD_BYTES) return { url: "", error: "图片类型或大小不符（svg 不接受）" };

    const key = `products/${productId}/content/${crypto.randomUUID()}.${img.ext}`;
    const bytes = await file.arrayBuffer();
    await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType: img.contentType, cacheControl: "public, max-age=31536000, immutable" },
    });
    return { url: mediaUrl(key) };
}

/** 删除一张商品图：解除关联 + 删 media_assets + 尽力删 R2 对象。 */
export async function deleteProductImageAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    const mediaId = String(formData.get("mediaId") ?? "");
    if (!productId || !mediaId) return;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const { r2Key } = await deleteProductImage(db, { productId, mediaId });
    if (r2Key) {
        try {
            await env.MEDIA.delete(r2Key);
        } catch {
            // 忽略：DB 已解除关联，孤儿对象可后续清理
        }
    }
    queueProductInvalidation({ ctx, db, productId });
}

/** 上移/下移一张商品图。 */
export async function moveProductImageAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    const mediaId = String(formData.get("mediaId") ?? "");
    const dir = String(formData.get("dir") ?? "") === "up" ? "up" : "down";
    if (!productId || !mediaId) return;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await moveProductImage(db, { productId, mediaId, dir });
    queueProductInvalidation({ ctx, db, productId });
}

/** 保存商品 SEO 覆盖（写 seo_meta，locale=en、市场级 NULL）；全空则删除→前台回退自动生成。 */
export async function saveSeoMetaAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.seoWrite);

    const productId = String(formData.get("productId") ?? "");
    if (!productId) return;
    const noindex = formData.get("noindex") === "on";

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
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

    queueProductInvalidation({ ctx, db, productId });
}

/** 设置商品归属类目 / 品牌（空串=清空）。仅写 products 行，可售/重算不受影响。 */
export async function assignCatalogAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.productWrite);

    const productId = String(formData.get("productId") ?? "");
    if (!productId) return;
    const categoryId = String(formData.get("categoryId") ?? "").trim() || null;
    const brandId = String(formData.get("brandId") ?? "").trim() || null;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    // 旧归属必须在写之前读：UPDATE ... RETURNING 只给新行，写完就查不到旧类目/品牌了，
    // 而它们那一页里这件商品刚被摘掉，同样得失效。
    const [prev] = await db
        .select({ categoryId: products.primaryCategoryId, brandId: products.brandId })
        .from(products)
        .where(eq(products.id, productId));
    await setProductCatalog(db, { productId, categoryId, brandId });

    queueCatalogInvalidation({
        ctx,
        db,
        productId,
        prev: { categoryId: prev?.categoryId ?? null, brandId: prev?.brandId ?? null },
        next: { categoryId, brandId },
    });
}
