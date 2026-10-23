/**
 * 输出净化：把"要塞进 HTML 的东西"变成安全的字符串（纯函数，可单测）。
 *
 * 三条都来自 2026-10-23 代码审查，每条当时都是可达的存储型 XSS：
 *
 * 1. **JSON-LD**：四处 `dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}`，
 *    而 `JSON.stringify` 会转义 `"` 和 `\`，**不会转义 `<`** —— 商品标题里放
 *    `</script><img src=x onerror=...>` 就跳出 script 上下文。更糟的是 URL 抓品会把远程页面
 *    的标题原样入库，且 `decodeEntities` 会把 `&lt;` 还原成真尖括号。
 * 2. **富文本链接**：`href={String(m.attrs?.href ?? "#")}` 无协议校验 → `javascript:` 可点。
 * 3. **图片 MIME**：只判 `startsWith("image/")` → 放行 `image/svg+xml`，而 SVG 能带脚本，
 *    存进 R2 后从 media 子域直接打开即执行（等于在自家域名下托管钓鱼页）。
 */

/** ① JSON-LD：把对象序列化成可以安全放进 <script type="application/ld+json"> 的字符串。 */
export function jsonLdScript(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        // U+2028/U+2029 在 JSON 字符串里合法但在 JS 里是行终止符，会让内联脚本报语法错。
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/** 允许出现在链接里的协议。其余（javascript:/data:/vbscript:）一律降级成 #。 */
const SAFE_SCHEMES = /^(https?:|mailto:|tel:|#|\/(?!\/))/i;

/** ② 链接：只放行 http/https/mailto/tel/页内锚点/站内相对路径。 */
export function safeHref(raw: unknown): string {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) return "#";
    // 先剥掉控制字符与空白（`java\tscript:` 这类绕过），再看协议。
    const cleaned = s.replace(/[\u0000-\u0020\u007f]/g, "");
    if (cleaned.startsWith("//")) return "#"; // 协议相对写法：跟着当前页变 https://evil.com，不白名单它
    if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned) && !SAFE_SCHEMES.test(cleaned)) return "#";
    return cleaned;
}

/** ③ 图片：显式白名单（SVG 故意排除 —— 它是可执行容器）。返回归一化 content-type 与扩展名。 */
const IMAGE_ALLOW: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
};

export interface AcceptedImage {
    /** 归一化后的 content-type（不要用远端/浏览器给的原值存进对象存储）。 */
    contentType: string;
    ext: string;
}

/** 通过返回归一化结果；不通过返回 null。 */
export function acceptedImageType(rawContentType: string | null | undefined): AcceptedImage | null {
    const ct = (rawContentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const ext = IMAGE_ALLOW[ct];
    if (!ext) return null; // 含 svg / heic / 任意未知类型：宁可不存，也不给它们一个归一化名字
    const canonical = ct === "image/jpg" ? "image/jpeg" : ct;
    return { contentType: canonical, ext };
}
