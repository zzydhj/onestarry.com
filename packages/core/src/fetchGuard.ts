/**
 * 服务端代抓外部 URL 前的准入判断（纯函数，可单测）。
 *
 * 背景：后台「贴链接 → 自动导入商品」会 fetch 用户填的 URL，还会把远程页面给出的
 * images 再抓一遍存进我们的 R2。旧实现只判了 `^https?://`，等于让后台变成一个
 * 「以 onestarry 名义向任意地址发请求」的代理（SSRF）+ 内容洗白通道。
 *
 * Workers 环境打不到云厂商链路本地元数据（169.254.169.254 由平台挡），但**不能把安全性
 * 建立在平台行为上** —— 这正是 /integration/* 那条"靠 Cloudflare 剥离头"的教训（实测今天
 * 是 401，可一旦哪天 Access 配置变了就是洞）。所以自己在纯函数层挡一遍，规则可单测、可 review。
 */

export interface UrlDecision {
    ok: boolean;
    reason?: string;
    /** 通过时给出规范化后的 URL 对象，调用方直接 fetch 它。 */
    url?: URL;
}

/** 单次抓取最多读多少字节（调用方必须流式截断，不能先 arrayBuffer 再判大小）。 */
export const MAX_FETCH_BYTES = 8 * 1024 * 1024;
/** 最多跟几次重定向。旧的 `redirect: "follow"` 等于让远端任意换目标，绕过本模块的判断。 */
export const MAX_REDIRECTS = 3;

/** 只允许标准 Web 端口：商品页不会在 :8080 上。 */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * 主机名黑名单（字面量层面）。DNS 解析后的内网地址需要 `cf-ipGeo`/解析库才能防，
 * 那是下一阶段（真要放开这个功能时再补）；这里先挡住最明显的写法。
 */
const BLOCKED_HOST_RE =
    /^(localhost$|.*\.(local|internal|intranet|localdomain|test|invalid)$|0\.0\.0\.0$|\[?(::1|::|\fe80|fc00|fd[0-9a-f]{2})\]?)/i;

export function isSafeRemoteUrl(raw: string, allowPrivate = false): UrlDecision {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: "URL 解析失败" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, reason: `协议不允许：${url.protocol}` };
    }
    if (url.username || url.password) return { ok: false, reason: "URL 不能带凭据" };
    if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: `端口不允许：${url.port}` };

    const host = url.hostname.toLowerCase();
    if (!allowPrivate && BLOCKED_HOST_RE.test(host)) return { ok: false, reason: `主机被拒绝：${host}` };
    if (!allowPrivate && isPrivateIpLiteral(host)) return { ok: false, reason: `私有/链路本地地址：${host}` };
    if (!host.includes(".") && !/^\[.*\]$/.test(host)) return { ok: false, reason: "主机名不完整" };

    return { ok: true, url };
}

/** 字面量形式的私网 / 环回 / 链路本地 / CGNAT IPv4（IPv6 走前缀粗判）。 */
function isPrivateIpLiteral(host: string): boolean {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 169 && b === 254) return true; // 云元数据
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / 部分云元数据段
        return false;
    }
    if (host.includes(":")) {
        const h = host.replace(/^\[/, "");
        if (/^::1$/.test(h) || h === "::") return true;
        if (/^f[ec-d][0-9a-f]/i.test(h)) return true; // fc00::/7 唯一本地、fe80::/10 链路本地
        if (/^::ffff:/i.test(h)) return true; // IPv4 映射写法
    }
    return false;
}
