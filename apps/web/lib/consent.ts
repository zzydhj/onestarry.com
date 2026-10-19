// 匿名访客的 Cookie 同意 = 第一方 cookie（GDPR 合规的"同意记录"本身，无需 DB 主体）。
// 登录用户的营销/条款同意才写 consents 表（有 subjectRef），不在此范围。
// necessary 类恒开、不记录；这里只管 analytics / marketing 两类非必需。

export const CONSENT_COOKIE = "cookie_consent";
export const CONSENT_VERSION = 1;
const MAX_AGE = 60 * 60 * 24 * 180; // 同意状态保留 180 天

export type ConsentState = {
    version: number;
    analytics: boolean;
    marketing: boolean;
    ts: string; // 记录时间（ISO），用于举证
};

/** 从 document.cookie 解析同意状态；未记录返回 null（据此决定是否弹横幅）。仅客户端。 */
export function readConsent(): ConsentState | null {
    if (typeof document === "undefined") return null;
    const prefix = `${CONSENT_COOKIE}=`;
    const pair = document.cookie.split("; ").find((c) => c.startsWith(prefix));
    if (!pair) return null;
    try {
        const o = JSON.parse(decodeURIComponent(pair.slice(prefix.length))) as ConsentState;
        return o && typeof o.version === "number" ? o : null;
    } catch {
        return null;
    }
}

/** 写入同意选择（覆盖旧值）。返回写入的状态。仅客户端。 */
export function saveConsent(prefs: { analytics: boolean; marketing: boolean }): ConsentState {
    const state: ConsentState = { version: CONSENT_VERSION, ...prefs, ts: new Date().toISOString() };
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${MAX_AGE}; samesite=lax${secure}`;
    return state;
}

/** 加载非必需脚本/埋点前调用：是否已同意该类（未同意一律 false）。 */
export function hasConsent(category: "analytics" | "marketing"): boolean {
    const c = readConsent();
    return c ? c[category] : false;
}
