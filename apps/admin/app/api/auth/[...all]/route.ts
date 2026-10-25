import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { isBlockedPublicAuthPath } from "@/lib/authGuard";
import { evictCachedSession, sessionCacheKey } from "@/lib/session-cache";

/**
 * Better Auth（admin 实例）catch-all 路由。
 * 与 customer 实例隔离：独立表前缀 admin_* + 独立 cookie（不同 origin: admin.onestarry.com）。
 * 需 Worker secret BETTER_AUTH_SECRET（wrangler secret put，见部署说明）。
 * 安全策略：**不开放公开注册**——/sign-up* 端点一律 403（建号只走团队页 Server Action 与 seed 脚本）。
 */
async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (isBlockedPublicAuthPath(url.pathname)) {
        return Response.json(
            { message: "后台不开放公开注册，请由超级管理员在「团队」页创建账号", code: "ADMIN_SIGN_UP_DISABLED" },
            { status: 403 },
        );
    }
    const { env } = getCloudflareContext();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: url.origin,
        secret: env.BETTER_AUTH_SECRET,
    });
    const res = await auth.handler(req);
    // 登出成功后立刻抹掉这份会话的 KV 快路，否则旧 cookie 在 TTL（60s）内仍能过守卫。
    // 只能抹自己这份：key 是从请求里的 cookie 算出来的。
    if (res.ok && url.pathname.endsWith("/sign-out")) {
        await evictCachedSession(env.SESSION_CACHE, await sessionCacheKey(req.headers.get("cookie")));
    }
    return res;
}

export const dynamic = "force-dynamic";
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
