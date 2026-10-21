import { headers } from "next/headers";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";

/**
 * 前台客户会话单一读取点（请求级 memo）。
 *
 * 为什么必须包 `cache()`：better-auth 取一次会话要 1–2 次跨区查询，而结账链路里
 * 页面、Server Action、布局都可能各读一遍。不去重就是**成倍付这个往返**，
 * 而结账正是用户"准备付钱"的那一步 —— 多等 200ms 都是实打实的流失。
 * `cache()` 只在同一请求内复用，不跨请求缓存，所以登出/换账号不会被旧会话卡住。
 *
 * 未登录返回 null（**不跳转**）：前台大部分页面对游客可见，需要登录的页面自己 redirect。
 */
async function loadCustomerSession() {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createCustomerAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) return null;
    return { env, userId: session.user.id, email: session.user.email };
}

export const readCustomerSession = cache(loadCustomerSession);
