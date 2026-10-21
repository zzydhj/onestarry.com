import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, getPrincipalPermissions } from "@onestarry/db";
import type { PermissionKey } from "@onestarry/core";

/**
 * 后台会话单一读取点：构造 admin 实例 → 取会话 → 载入其权限集。
 * 未登录返回 null（**不跳转**），供 layout/导航做渐进式渲染；需强制登录请用 requireAdmin。
 */
export async function readAdminSession() {
    const { env, ctx } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) return null;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const permissions = await getPrincipalPermissions(db, session.user.id);
    return { env, ctx, userId: session.user.id, permissions };
}

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
