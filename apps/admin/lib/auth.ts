import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { getPrincipalPermissions } from "@onestarry/db";
import { getRequestDb } from "./db";
import type { PermissionKey } from "@onestarry/core";

/**
 * 后台会话单一读取点：构造 admin 实例 → 取会话 → 载入其权限集。
 * 未登录返回 null（**不跳转**），供 layout/导航做渐进式渲染；需强制登录请用 requireAdmin。
 *
 * ⏱ 必须用 React `cache()` 包住（请求级 memo）：一次导航里 layout 与 page 都会读会话，
 * 不去重就是**完整查两遍**（better-auth 取 session + 权限 JOIN，各 1–2 次往返）。
 * 主库在 US-East、边缘在 HK，每次往返 ~150–190ms，双份白付 0.6–1.1s。
 * `cache()` 的键是函数参数（此处无参）→ 同一请求内只跑一次，不跨请求缓存，
 * 所以权限变更仍是即时生效（区别于带 TTL 的 isolate 缓存）。详见 docs/PERF.md。
 *
 * ⏱ 连接也只一条：本函数与 better-auth、页面/Action 共用 `getRequestDb` 的结果。
 * 原先三处各自 `createDb` → 一次渲染 3 条新连接，而每条连接要 4–6 次跨洋往返（握手），
 * 实测就是后台“每次点击 2.4 秒”的主因（取证与算法见 lib/db.ts 顶部注释）。
 */
async function loadAdminSession() {
    const { env, ctx } = getCloudflareContext();
    const h = await headers();
    // 客户端是惰建连的：无 cookie 时 getSession 直接返回 null，一次查询也不发，未登录仍然很快。
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
