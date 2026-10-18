import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

/** 批量导入页（受保护）：上传 CSV，按 SKU upsert 商品。 */
export default async function ImportPage() {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    return (
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/products">← 返回商品列表</Link></p>
            <h1 style={{ fontSize: 22 }}>批量导入商品（CSV）</h1>
            <p style={{ fontSize: 13, color: "#666", lineHeight: 1.7 }}>
                第一行为表头。按 <code>sku</code> 匹配：存在则更新、不存在则新建。<br />
                列：<code>sku, slug, title, description, basePrice, cost, weight, onHand, status, imageUrl</code><br />
                价格/成本填美元（如 <code>19.99</code>），重量克，库存整数，status 取 <code>draft/active/archived</code>；<code>imageUrl</code> 会下载存进 R2 并挂为商品图；留空的列不改动。
            </p>
            <ImportForm />
        </main>
    );
}
