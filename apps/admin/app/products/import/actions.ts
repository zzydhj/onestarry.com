"use server";

import { acceptedImageType, csvToObjects, PERMISSIONS } from "@onestarry/core";
import { attachProductImage, upsertProductFromRow, type ImportRowInput } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { runRelayBatch, relayHandlers } from "@onestarry/jobs";
import { requirePermission } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { readCapped, safeFetch } from "@/lib/safeFetch";
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
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * 拓图：下载 imageUrl → 存 R2（products/{id}/imported-…）→ 挂为商品图。
 *
 * ⚠ 旧实现三个问题叠在一起（2026-10-23 审查 P1-9 / P1-10）：
 *   · `fetch(url)` 不判目标 → 后台变成以我方边缘发任意请求的代理；
 *   · `startsWith("image/")` 放行 SVG → 可执行内容存进 media 子域；
 *   · 先 `arrayBuffer()` 再判大小 → 上限形同虚设（先把内存吃完）。
 * 现在走 safeFetch（逐跳重判 + 超时）+ acceptedImageType 白名单 + readCapped 流式截断。
 */
async function importImage(env: CloudflareEnv, productId: string, url: string): Promise<{ ok: boolean; error?: string }> {
    if (!isUuid(productId)) return { ok: false, error: "商品 id 形状不符" };
    try {
        const res = await safeFetch(url);
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const img = acceptedImageType(res.headers.get("content-type"));
        if (!img) return { ok: false, error: "非白名单图片类型（svg 不接受）" };
        const bytes = await readCapped(res, MAX_IMAGE_BYTES);
        const key = `products/${productId}/imported-${crypto.randomUUID().slice(0, 8)}.${img.ext}`;
        await env.MEDIA.put(key, bytes, {
            httpMetadata: { contentType: img.contentType, cacheControl: "public, max-age=31536000, immutable" },
        });
        await attachProductImage(getRequestDb(env.HYPERDRIVE.connectionString), {
            productId,
            r2Key: key,
            mimeType: img.contentType,
            sizeBytes: bytes.byteLength,
        });
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
    if (file.size > MAX_CSV_BYTES) {
        summary.failed.push({ sku: "(整体)", reason: `文件超过 ${Math.floor(MAX_CSV_BYTES / 1024)} KB 上限` });
        return summary;
    }

    const objs = csvToObjects(await file.text());
    summary.total = objs.length;
    if (objs.length > MAX_ROWS) {
        summary.failed.push({ sku: "(整体)", reason: `超过 ${MAX_ROWS} 行上限` });
        return summary;
    }

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
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
    // 具体的协议/主机/端口/凭据拦截在 safeFetch 里逐跳做（那里还能挡住重定向绕道）。
    const r = await fetchProductFromUrl(clean);
    if (!r.draft) return { ok: false, error: r.error ?? "抓取失败" };
    const d = r.draft;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
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
