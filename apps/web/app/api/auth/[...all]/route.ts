import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";

/**
 * Better Auth（customer 实例）catch-all 路由。
 * Workers 无常驻 db：每请求用 env.HYPERDRIVE 构造实例，交给 auth.handler。
 * 需 Worker secret BETTER_AUTH_SECRET（wrangler secret put / .dev.vars 本地）。
 *
 * ⚠️ 临时调试壳：捕获异常并以 JSON 返回，便于线上定位 500 根因；定位后移除。
 */
async function handle(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const auth = createCustomerAuth({
      connString: env.HYPERDRIVE.connectionString,
      baseURL: new URL(req.url).origin,
      secret: env.BETTER_AUTH_SECRET,
    });
    return await auth.handler(req);
  } catch (e) {
    const err = e as Error;
    return new Response(
      JSON.stringify({
        debug: true,
        message: err?.message ?? String(e),
        name: err?.name,
        stack: err?.stack,
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

export const dynamic = "force-dynamic";
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
