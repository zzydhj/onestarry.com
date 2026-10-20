import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, getPrincipalPermissions } from "@onestarry/db";
import type { PermissionKey } from "@onestarry/core";

/** 后台 Server Action 通用守卫：取 env/ctx + 校验管理员会话 + 载入其权限集，未登录跳 /signin。 */
export async function requireAdmin() {
    const { env, ctx } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");
    const db = createDb(env.HYPERDRIVE.connectionString);
    const permissions = await getPrincipalPermissions(db, session.user.id);
    return { env, ctx, userId: session.user.id, permissions };
}

/** 权限守卫：在 requireAdmin 基础上强制某权限点，不足即拒（Server Action 抛错，由 error 边界接住）。 */
export async function requirePermission(perm: PermissionKey) {
    const auth = await requireAdmin();
    if (!auth.permissions.has(perm)) throw new Error(`FORBIDDEN:${perm}`);
    return auth;
}
