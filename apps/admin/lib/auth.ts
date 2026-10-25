import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { getPrincipalPermissions } from "@onestarry/db";
import { getRequestDb } from "./db";
import { readCachedSession, sessionCacheKey, writeCachedSession } from "./session-cache";
import type { PermissionKey } from "@onestarry/core";

/**
 * 后台会话单一读取点：构造 admin 实例 → 取会话 → 载入其权限集。
 * 未登录返回 null（**不跳转**），供 layout/导航做渐进式渲染；需强制登录请用 requireAdmin。
 *
 * ⏱ 必须用 React `cache()` 包住（请求级 memo）：一次导航里 layout 与 page 都会读会话，
 * 不去重就是**完整查两遍**（better-auth 取 session + 权限 JOIN，各 1–2 次往返）。
 *
 * ⏱ 跨请求还有一层 KV 边缘缓存（K 方案，见 lib/session-cache.ts）：命中时鉴权 0 次查库。
 *    所以「权限变更即时生效」这句话现在只对**同一请求内**成立；跨请求的撤销窗口 = 60 秒
 *    （登出走 sign-out 路由主动删 key，即时）。这是有意的取舍，理由与边界全写在那份文件顶部。
 *
 * ⏱ 连接也只一条：本函数与 better-auth、页面/Action 共用 `getRequestDb` 的结果。
 * 原先三处各自 `createDb` → 一次渲染 3 条新连接，而每条连接要 4–6 次跨洋往返（握手），
 * 实测就是后台“每次点击 2.4 秒”的主因（取证与算法见 lib/db.ts 顶部注释）。
 */
async function loadAdminSession() {
    const { env, ctx } = getCloudflareContext();
    const h = await headers();
    const kv = env.SESSION_CACHE;
    const key = await sessionCacheKey(h.get("cookie"));

    // 快路：60 秒内刚刚验过的会话，一次边缘 KV 读就够。
    const hit = await readCachedSession(kv, key);
    if (hit) {
        return { env, ctx, userId: hit.userId, permissions: new Set<PermissionKey>(hit.permissions) };
    }

    // 权威路径：better-auth 验签 + 查会话 + 查权限。客户端是惰建连的，
    // 无 cookie / 验签不过时 getSession 直接返回 null，一次查询也不发，未登录仍然很快。
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        db,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) return null;
    const permissions = await getPrincipalPermissions(db, session.user.id);
    // 只缓存已验证成功的会话；未登录不写，免得登录页与扫描流量往 KV 堆垃圾。
    await writeCachedSession(kv, key, { userId: session.user.id, permissions: [...permissions] });
    return { env, ctx, userId: session.user.id, permissions };
}

export const readAdminSession = cache(loadAdminSession);

/** 后台 Server Action / 页面通用守卫：取 env/ctx + 校验管理员会话 + 载入其权限集，未登录跳 /signin。 */
export async function requireAdmin() {
    const session = await readAdminSession();
    if (!session) redirect("/signin");
    return session;
}

/** 权限守卫：在 requireAdmin 基础上强制某权限点，不足即拒（Server Action 抛错，由 error 边界接住）。 */
export async function requirePermission(perm: PermissionKey) {
    const auth = await requireAdmin();
    if (!auth.permissions.has(perm)) throw new Error(`FORBIDDEN:${perm}`);
    return auth;
}
