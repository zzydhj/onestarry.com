import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";

/**
 * Better Auth（customer 实例）catch-all 路由。
 * Workers 无常驻 db：每请求用 env.HYPERDRIVE 构造实例，交给 auth.handler。
 * 依赖 Worker secret BETTER_AUTH_SECRET（用 `wrangler secret put` 设置；
 * 注意 Workers Builds 每次部署会清掉 Dashboard 设的变量，只有 secret put 写入的会保留）。
 */
async function handle(req: Request): Promise<Response> {
    const { env } = getCloudflareContext();
    const auth = createCustomerAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: new URL(req.url).origin,
        secret: env.BETTER_AUTH_SECRET,
    });
    return auth.handler(req);
}

export const dynamic = "force-dynamic";
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
