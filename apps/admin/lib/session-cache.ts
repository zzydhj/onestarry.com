import type { PermissionKey } from "@onestarry/core";

/**
 * 会话结果的边缘缓存（K 方案）—— 把后台每次导航的鉴权开销从 2–3 趟跨洋查询换成一次 KV 读。
 *
 * 为什么值得做（线上取证见 docs/PERF.md §2 第⑪行）：
 *   `GET /products` wall 2487ms / cpu 44ms，其中鉴权（better-auth 取会话 + 权限 JOIN）占 1.4–1.8s，
 *   页面自己的数据查询只占 ~650ms。CPU 几乎为零 —— 时间全在等跨洋往返，所以「少等几趟」就是省时间。
 *
 * 为什么安全方向是对的：
 *   · 缓存只是**快路**，权威仍是 better-auth：任何未命中/异常/形状不认识都退回原路径，
 *     最坏情况是"退回现在的速度"，不会变成"放行了不该放行的会话"。
 *   · 存进去的是**已验证过**的结果（写缓存的前提是 getSession 成功返回了 user），
 *     所以命中等价于"60 秒内刚刚验过"，不是跳过验证。
 *   · key 是会话 cookie 值的 SHA-256，**不存任何凭据**；拿到 KV 内容也推不回 cookie 值。
 *     而能算出这个 key 的人本来就已经持有 cookie。
 *   · 不缓存 null（未登录），登录页和扫描流量不会往 KV 里堆垃圾。
 *
 * ⚠ 唯一的语义代价（改这里之前必须知道）：
 *   · **登出即时生效**：sign-out 路由会主动删自己这份 key。
 *   · **改别人的权限/角色最长 60 秒才生效** —— 撤权时你算不出对方那份 key，只能等 TTL 过期。
 *     这是"撤销延迟"，不是"权限放大窗口"之外的额外洞；若将来要即时，正解是 J（无状态令牌 +
 *     权限每次查）或给每用户加一个版本号参与 key，而不是把 TTL 调成 0（那等于关掉缓存）。
 *   · KV 是最终一致：delete 传播到所有边缘最长约 60 秒，所以"登出即时"在极端情况下也是分钟级以内。
 */

/** 缓存窗口（秒）。调大 = 命中率更高、撤销窗口更长。 */
const TTL_SECONDS = 60;

/** better-auth 双实例的会话 cookie 名（生产带 __Secure- 前缀，本地 dev 不带）。 */
const SESSION_COOKIE_NAMES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

export interface CachedAdminSession {
    userId: string;
    permissions: PermissionKey[];
}

type SessionCache = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
};

/** 从 cookie 头里取会话凭据并算出缓存 key；没带会话 cookie → null（不查缓存也不写）。 */
export async function sessionCacheKey(cookieHeader: string | null): Promise<string | null> {
    if (!cookieHeader) return null;
    let token: string | null = null;
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const name = part.slice(0, eq).trim();
        if (SESSION_COOKIE_NAMES.includes(name)) {
            token = part.slice(eq + 1).trim();
            break;
        }
    }
    if (!token) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** 读快路。任何异常都当未命中（缓存坏不能把页面带崩，更不能把鉴权带崩）。 */
export async function readCachedSession(
    kv: SessionCache | undefined,
    key: string | null,
): Promise<CachedAdminSession | null> {
    if (!kv || !key) return null;
    try {
        const raw = await kv.get(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedAdminSession;
        if (!parsed?.userId || !Array.isArray(parsed.permissions)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export async function writeCachedSession(
    kv: SessionCache | undefined,
    key: string | null,
    value: CachedAdminSession,
): Promise<void> {
    if (!kv || !key) return;
    try {
        await kv.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
    } catch {
        // 写失败只是这次没缓存上，下次走权威路径。
    }
}

export async function evictCachedSession(kv: SessionCache | undefined, key: string | null): Promise<void> {
    if (!kv || !key) return;
    try {
        await kv.delete(key);
    } catch {
        // 删不掉就退化成 TTL 到期，可接受。
    }
}
