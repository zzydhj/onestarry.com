import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";

/**
 * Better Auth（admin 实例）catch-all 路由。
 * 与 customer 实例隔离：独立表前缀 admin_* + 独立 cookie（不同 origin: admin.onestarry.com）。
 * 需 Worker secret BETTER_AUTH_SECRET（wrangler secret put，见部署说明）。
 */
async function handle(req: Request): Promise<Response> {
    const { env } = getCloudflareContext();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: new URL(req.url).origin,
        secret: env.BETTER_AUTH_SECRET,
    });
    return auth.handler(req);
}

export const dynamic = "force-dynamic";
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
