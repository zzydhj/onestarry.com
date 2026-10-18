import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, products, productTranslations } from "@onestarry/db";

export const dynamic = "force-dynamic";

/** 后台商品列表（受保护）：未登录跳登录页；读全部商品（跨市场/状态）。 */
export default async function AdminProducts() {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const db = createDb(env.HYPERDRIVE.connectionString);
    const rows = await db
        .select({
            id: products.id,
            status: products.status,
            title: productTranslations.title,
        })
        .from(products)
        .leftJoin(
            productTranslations,
            and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, "en")),
        )
        .orderBy(desc(products.createdAt))
        .limit(200);

    return (
        <div className="mx-auto max-w-4xl px-4 py-8">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold tracking-tight">商品 <span className="text-sm font-normal text-muted">（{rows.length}）</span></h1>
                <div className="flex gap-2">
                    <Link href="/products/new" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90">＋ 新建商品</Link>
                    <Link href="/products/import" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:bg-surface">⇪ 批量导入</Link>
                </div>
            </div>
            <table className="mt-6 w-full text-sm">
                <thead>
                    <tr className="border-b border-line text-left text-muted">
                        <th className="py-2 pr-2 font-medium">标题</th>
                        <th className="py-2 pr-2 font-medium">状态</th>
                        <th className="py-2 font-medium">商品 ID</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} className="border-b border-line">
                            <td className="py-2 pr-2">
                                <Link href={`/products/${r.id}`} className="text-accent hover:underline">{r.title ?? <em className="text-red-600">（缺英文文案）</em>}</Link>
                            </td>
                            <td className="py-2 pr-2">{r.status}</td>
                            <td className="py-2 font-mono text-xs text-muted">{r.id}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
