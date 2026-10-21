"use server";

import { csvToObjects, PERMISSIONS } from "@onestarry/core";
import { createDb, attachProductImage, upsertProductFromRow, type ImportRowInput } from "@onestarry/db";
import { runRelayBatch, relayHandlers } from "@onestarry/jobs";
import { requirePermission } from "@/lib/auth";
import { fetchProductFromUrl } from "@/lib/importProviders";

export interface ImportSummary {
    total: number;
    created: number;
    updated: number;
    imagesImported: number;
    failed: { sku: string; reason: string }[];
    imageFailed: { sku: string; reason: string }[];
}

const MAX_ROWS = 5000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 拓图：下载 imageUrl → 存 R2（products/{id}/imported-…）→ 挂为商品图。 */
async function importImage(env: CloudflareEnv, productId: string, url: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.startsWith("image/")) return { ok: false, error: "非图片类型" };
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "图片过大(>8MB)" };
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
        const key = `products/${productId}/imported-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        await env.MEDIA.put(key, buf, { httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000, immutable" } });
        await attachProductImage(createDb(env.HYPERDRIVE.connectionString), { productId, r2Key: key, mimeType: ct, sizeBytes: buf.byteLength });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "抓取失败" };
    }
}

function toCents(v: string | undefined): number | null {
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function toInt(v: string | undefined): number | null {
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
}

/** 批量导入：解析 CSV → 按 SKU upsert 每行（各自事务）→ 末尾统一重算价格缓存 → 返回结果报告。 */
export async function importProductsAction(formData: FormData): Promise<ImportSummary> {
    const { env, userId } = await requirePermission(PERMISSIONS.productWrite);

    const summary: ImportSummary = { total: 0, created: 0, updated: 0, imagesImported: 0, failed: [], imageFailed: [] };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return summary;

    const objs = csvToObjects(await file.text());
    summary.total = objs.length;
    if (objs.length > MAX_ROWS) {
        summary.failed.push({ sku: "(整体)", reason: `超过 ${MAX_ROWS} 行上限` });
        return summary;
    }

    const db = createDb(env.HYPERDRIVE.connectionString);
    for (const o of objs) {
        const sku = (o.sku || "").trim();
        if (!sku) {
            summary.failed.push({ sku: "(空)", reason: "缺 sku" });
            continue;
        }
        const s = (o.status || "").trim().toLowerCase();
        const status = s === "active" || s === "draft" || s === "archived" ? s : null;
        const input: ImportRowInput = {
            sku,
            slug: (o.slug || "").trim() || null,
            title: (o.title || "").trim() || null,
            description: (o.description || "").trim() || null,
            basePriceCents: toCents(o.baseprice ?? o.price),
            costCents: toCents(o.cost),
            weightG: toInt(o.weight),
            onHand: toInt(o.onhand ?? o.stock),
            status,
            changedBy: userId,
        };
        try {
            const res = await db.transaction(async (tx) => upsertProductFromRow(tx, input));
            if (res.action === "created") summary.created++;
            else summary.updated++;

            const imageUrl = (o.imageurl || "").trim();
            if (imageUrl) {
                const img = await importImage(env, res.productId, imageUrl);
                if (img.ok) summary.imagesImported++;
                else summary.imageFailed.push({ sku, reason: img.error ?? "抓取失败" });
            }
        } catch (e) {
            summary.failed.push({ sku, reason: e instanceof Error ? e.message : String(e) });
        }
    }

    // 统一重算所有受影响的全包价缓存
    await runRelayBatch(db, relayHandlers, { limit: MAX_ROWS * 4 });

    return summary;
}

/**
 * 按产品链接抓取导入：provider 解析 → 建 draft 草稿 → 抓图转存 R2 → 返回商品 id（前端跳编辑页审核）。
 * 需 product:write。淘宝/1688 返回需专用 API 的提示（needsProvider）。
 */
export async function importFromUrlAction(url: string): Promise<{ ok: boolean; productId?: string; error?: string }> {
    const { env, userId } = await requirePermission(PERMISSIONS.productWrite);
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return { ok: false, error: "请输入 http(s):// 开头的链接" };
    const r = await fetchProductFromUrl(clean);
    if (!r.draft) return { ok: false, error: r.error ?? "抓取失败" };
    const d = r.draft;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const sku = d.sku?.trim() || `IMP-${Date.now().toString(36).toUpperCase()}`;
    const res = await db.transaction(async (tx) =>
        upsertProductFromRow(tx, {
            sku,
            title: d.title,
            description: d.description,
            basePriceCents: d.basePriceCents,
            status: "draft",
            changedBy: userId,
        }),
    );
    for (const img of d.images.slice(0, 8)) {
        await importImage(env, res.productId, img);
    }
    await runRelayBatch(db, relayHandlers, { limit: 8 });
    return { ok: true, productId: res.productId };
}
