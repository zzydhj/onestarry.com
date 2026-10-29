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
        const p = obj(obj(JSON.parse(await readCappedText(res, MAX_PAGE_BYTES)))?.product);
        const title = text(p?.title);
        if (!p || !title) return null;
        const variant = obj(Array.isArray(p.variants) ? p.variants[0] : undefined);
        const body = text(p.body_html);
        return {
            title,
            description: body ? stripHtml(body).slice(0, 4000) : null,
            basePriceCents: toCents(variant?.price),
            currency: text(p.currency) ?? text(variant?.currency) ?? "USD",
            images: normImages(p.images, "src"),
            sku: text(variant?.sku),
            categoryHint: text(p.product_type),
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
            const n = obj(node);
            if (!n) continue;
            const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
            if (!types.includes("Product")) continue;
            const offer = obj(Array.isArray(n.offers) ? n.offers[0] : n.offers);
            const title = text(n.name);
            // 连可用标题都没有的 Product 节点不算解析成功：旧写法 `String(n.name)` 会造出
            // "[object Object]" 当商品名并继续导入，真建出一个空标题商品比报错难发现得多。
            if (!title) continue;
            const description = text(n.description);
            const category = text(n.category);
            return {
                title,
                description: description ? description.slice(0, 4000) : null,
                basePriceCents: toCents(offer?.price),
                currency: text(offer?.priceCurrency) ?? "USD",
                images: normImages(n.image, "url", "content"),
                sku: text(n.sku) ?? text(n.mpn),
                categoryHint: category ? category.slice(0, 120) : null,
                sourceUrl: "",
            };
        }
    }
    return null;
}

// —— 小工具 ——
/**
 * 把外部 JSON 的值收窄成普通对象（不是对象/是数组都给 null）。
 * 为什么不用 `as Record<string, any>`（审查 L-4）：那是把**别人服务器返什么形状都不保证**的东西当作已知类型，
 * 旧的 `(i: any) => i?.src` 就能把 `{src: 123}` 里的 **数字塞进声明为 `string[]` 的 images**，直接交给上层当 URL 拉。
 * 现在类型上不成立：不过这道闸就编译不过。
 */
function obj(v: unknown): Record<string, unknown> | null {
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 取字段并强制成文本：只接受字符串与有限数，其它一律 null（不再出现 "[object Object]" 这种拼接垃圾）。 */
function text(v: unknown): string | null {
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
}
function flattenLd(data: unknown): unknown[] {
    if (!data) return [];
    if (Array.isArray(data)) return data.flatMap(flattenLd);
    const d = data as Record<string, unknown>;
    if (Array.isArray(d["@graph"])) return (d["@graph"] as unknown[]).flatMap(flattenLd);
    return [data];
}

/** 图片字段归一：商品源里 image/images 既可以是字符串、也可以是对象数组，而且字段名不一（Shopify 用 src，LD 用 url/content）。 */
function normImages(img: unknown, ...fields: string[]): string[] {
    if (!img) return [];
    const out: string[] = [];
    for (const x of Array.isArray(img) ? img : [img]) {
        if (typeof x === "string") {
            out.push(x);
            continue;
        }
        const o = obj(x);
        for (const f of fields) {
            const v = text(o?.[f]);
            if (v) {
                out.push(v);
                break;
            }
        }
    }
    return out;
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
