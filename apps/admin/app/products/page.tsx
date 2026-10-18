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
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <h1 style={{ fontSize: 22 }}>商品 <span style={{ fontSize: 13, color: "#888" }}>（{rows.length}）</span></h1>
            <p><Link href="/">← 返回后台首页</Link></p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                        <th style={{ padding: "6px 8px" }}>标题</th>
                        <th style={{ padding: "6px 8px" }}>状态</th>
                        <th style={{ padding: "6px 8px" }}>商品 ID</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "6px 8px" }}>
                                <Link href={`/products/${r.id}`} style={{ color: "#0366d6", textDecoration: "none" }}>
                                    {r.title ?? <em style={{ color: "#c00" }}>（缺英文文案）</em>}
                                </Link>
                            </td>
                            <td style={{ padding: "6px 8px" }}>{r.status}</td>
                            <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 12, color: "#888" }}>{r.id}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </main>
    );
}
