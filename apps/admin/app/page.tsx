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
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
            {session?.user ? (
                <>
                    <p className="mt-1 text-sm text-muted">已登录：<strong className="text-fg">{session.user.email}</strong></p>
                    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                        {[
                            { href: "/products", label: "商品管理" },
                            { href: "/orders", label: "订单管理" },
                            { href: "/categories", label: "类目管理" },
                            { href: "/markets", label: "市场配置" },
                        ].map((c) => (
                            <Link
                                key={c.href}
                                href={c.href}
                                className="rounded-xl border border-line bg-white p-4 font-medium transition hover:border-accent hover:shadow-sm"
                            >
                                {c.label}
                            </Link>
                        ))}
                    </div>
                    <p className="mt-6 text-sm text-muted">改价 / 上下架 / 库存 / 新建 / 图片 / 图文详情 / 批量导入 均在「商品管理」内。</p>
                </>
            ) : (
                <p className="mt-6 text-muted">未登录 · <Link href="/signin" className="text-accent hover:underline">去登录</Link></p>
            )}
        </div>
    );
}
