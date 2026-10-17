import { headers } from "next/headers";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";

export const dynamic = "force-dynamic";

/** 后台首页：读 admin 会话；未登录引导到 /signin。 */
export default async function AdminHome() {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });

    return (
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <h1 style={{ fontSize: 22 }}>onestarry · 管理后台</h1>
            {session?.user ? (
                <>
                    <p>已登录：<strong>{session.user.email}</strong></p>
                    <p style={{ color: "#666" }}>后台功能（商品/改价/类目/市场/库存/批量导入）将在此逐步接入。</p>
                </>
            ) : (
                <p>
                    未登录 · <Link href="/signin">去登录</Link>
                </p>
            )}
        </main>
    );
}
