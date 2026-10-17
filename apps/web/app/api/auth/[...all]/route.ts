import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";

/**
 * Better Auth（customer 实例）catch-all 路由。
 * ⚠️ 临时调试壳：捕获异常 + 回显 env 诊断（只报键是否存在/长度，绝不回显密钥值）；定位后移除。
 */
async function handle(req: Request): Promise<Response> {
  let diag: Record<string, unknown> = {};
  try {
    const { env } = getCloudflareContext();
    diag = {
      hasHyperdrive: !!env?.HYPERDRIVE?.connectionString,
      secretType: typeof env?.BETTER_AUTH_SECRET,
      secretLen: env?.BETTER_AUTH_SECRET?.length ?? null,
    };
    const auth = createCustomerAuth({
      connString: env.HYPERDRIVE.connectionString,
      baseURL: new URL(req.url).origin,
      secret: env.BETTER_AUTH_SECRET,
    });
    return await auth.handler(req);
  } catch (e) {
    const err = e as Error;
    return new Response(
      JSON.stringify({ debug: true, diag, message: err?.message ?? String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

export const dynamic = "force-dynamic";
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
