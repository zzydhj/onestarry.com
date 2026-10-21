import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { isBlockedPublicAuthPath } from "@/lib/authGuard";

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
    return auth.handler(req);
}

export const dynamic = "force-dynamic";
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
