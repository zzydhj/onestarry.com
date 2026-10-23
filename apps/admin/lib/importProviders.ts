import { readCappedText, safeFetch } from "./safeFetch";

/**
 * URL 商品抓取 provider（「贴链接→自动导入」）。可插拔：
 * - 通用源（Shopify / JSON-LD / OpenGraph）：纯代码 fetch 解析，零外部依赖。
 * - 淘宝/天猫/1688：登录墙+反爬，需 1688 官方开放平台或第三方商品详情 API → provider 插槽（待填 endpoint+key）。
 * - LLM 抽取增强：待接 LLM API（另见 enrichWithLlm 插槽）。
 */
export interface ProductImportDraft {
    title: string;
    description: string | null;
    basePriceCents: number | null;
    currency: string;
    images: string[]; // 绝对 URL，交给上层下载转存 R2
    sku: string | null;
    categoryHint: string | null;
    sourceUrl: string;
}

export interface ProviderResult {
    draft?: ProductImportDraft;
    error?: string;
    needsProvider?: boolean; // 淘宝/1688 等需专用 API
}

const TAOBAO_RE = /(taobao\.com|tmall\.com|1688\.com|alibaba\.com)/i;
/** 单个外部页面的读取上限（商品页不会更大；超限由 readCappedText 断流）。 */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

export function detectSource(url: string): "taobao" | "shopify" | "generic" {
    if (TAOBAO_RE.test(url)) return "taobao";
    if (/\.myshopify\.com|\/products?\/|\/product\/|shopify/i.test(url)) return "shopify";
    return "generic";
}

/** 主入口：按源选择 provider 抓取。 */
export async function fetchProductFromUrl(url: string): Promise<ProviderResult> {
    const src = detectSource(url);
    if (src === "taobao") {
        return {
            needsProvider: true,
            error:
                "淘宝/天猫/1688 有登录墙与反爬，无法直接抓取。需接入 1688 官方开放平台或第三方商品详情 API（提供 endpoint+key 后由 provider 适配）。当前未配置该源。",
        };
    }
    let draft: ProductImportDraft | null = null;
    if (src === "shopify") draft = await tryShopify(url);
    if (!draft) draft = await tryJsonLdOrOg(url);
    if (!draft) {
        return { error: "未能从该页解析出商品数据（无 Shopify JSON / JSON-LD / OpenGraph）。可启用 LLM 抽取增强。" };
    }
    draft.sourceUrl = url;
    return { draft };
}

// —— Shopify 公开 JSON（<product-url>.json）——
async function tryShopify(url: string): Promise<ProductImportDraft | null> {
    const jsonUrl = (url.split("?")[0] ?? url).replace(/\/+$/, "") + ".json";
    try {
        // safeFetch 会拒掉私网/元数据/非标准端口，且逐跳重判（旧写法直连 fetch 无上限无超时）。
        const res = await safeFetch(jsonUrl);
        if (!res.ok) return null;
        const j = JSON.parse(await readCappedText(res, MAX_PAGE_BYTES)) as Record<string, any>;
        const p = j?.product;
        if (!p?.title) return null;
        const images: string[] = Array.isArray(p.images)
            ? p.images.map((i: any) => (typeof i === "string" ? i : i?.src)).filter(Boolean)
            : [];
        const variant = Array.isArray(p.variants) ? p.variants[0] : null;
        return {
            title: String(p.title),
            description: p.body_html ? stripHtml(String(p.body_html)).slice(0, 4000) : null,
            basePriceCents: toCents(variant?.price),
            currency: String(p.currency || variant?.currency || "USD"),
            images,
            sku: variant?.sku ? String(variant.sku) : null,
            categoryHint: p.product_type ? String(p.product_type) : null,
            sourceUrl: url,
        };
    } catch {
        return null;
    }
}

// —— 通用：JSON-LD Product，兜底 OpenGraph ——
async function tryJsonLdOrOg(url: string): Promise<ProductImportDraft | null> {
    try {
        const res = await safeFetch(url);
        if (!res.ok) return null;
        const html = await readCappedText(res, MAX_PAGE_BYTES);
        const ld = extractJsonLdProduct(html);
        if (ld) return ld;
        const title = metaContent(html, "og:title") || titleTag(html);
        if (!title) return null;
        const image = metaContent(html, "og:image");
        return {
            title,
            description: metaContent(html, "og:description") || metaContent(html, "description"),
            basePriceCents: null,
            currency: "USD",
            images: image ? [image] : [],
            sku: null,
            categoryHint: null,
            sourceUrl: url,
        };
    } catch {
        return null;
    }
}

function extractJsonLdProduct(html: string): ProductImportDraft | null {
    const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const b of blocks) {
        let data: unknown;
        try {
            data = JSON.parse(b[1]?.trim() ?? "");
        } catch {
            continue;
        }
        for (const node of flattenLd(data)) {
            const n = node as Record<string, any>;
            const types = Array.isArray(n?.["@type"]) ? n["@type"] : [n?.["@type"]];
            if (!types.includes("Product")) continue;
            const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers;
            return {
                title: String(n.name || ""),
                description: n.description ? String(n.description).slice(0, 4000) : null,
                basePriceCents: toCents(offer?.price),
                currency: String(offer?.priceCurrency || "USD"),
                images: normImages(n.image),
                sku: n.sku ? String(n.sku) : n.mpn ? String(n.mpn) : null,
                categoryHint: n.category ? String(n.category).slice(0, 120) : null,
                sourceUrl: "",
            };
        }
    }
    return null;
}

// —— 小工具 ——
function flattenLd(data: unknown): unknown[] {
    if (!data) return [];
    if (Array.isArray(data)) return data.flatMap(flattenLd);
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["@graph"])) return (d["@graph"] as unknown[]).flatMap(flattenLd);
    return [data];
}

function normImages(img: unknown): string[] {
    if (!img) return [];
    const arr = Array.isArray(img) ? img : [img];
    return arr
        .map((x) => (typeof x === "string" ? x : (x as Record<string, unknown>)?.url || (x as Record<string, unknown>)?.content))
        .filter(Boolean)
        .map(String);
}

function metaContent(html: string, key: string): string | null {
    const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
        "i",
    );
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    return v ? decodeEntities(v) : null;
}

function titleTag(html: string): string | null {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}

function stripHtml(s: string): string {
    return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function toCents(n: unknown): number | null {
    const v = typeof n === "string" ? parseFloat(n.replace(/[^0-9.]/g, "")) : Number(n);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}
