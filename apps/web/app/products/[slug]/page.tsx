import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getProductById, resolveSlug } from "@onestarry/db";

export const dynamic = "force-dynamic";

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);

    const res = await resolveSlug(db, { entityType: "product", locale: "en", slug });
    if (!res) notFound();
    if (res.status === "redirect") permanentRedirect(`/products/${res.toSlug}`);

    const p = await getProductById(db, res.entityId, "us", "en");
    if (!p) notFound();

    return (
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <Link href="/" style={{ color: "#666", fontSize: 14 }}>← 全部商品</Link>
            <h1 style={{ fontSize: 26, margin: "12px 0 4px" }}>{p.title}</h1>
            <p style={{ color: "#666" }}>{p.description}</p>
            <div style={{ fontSize: 24, fontWeight: 700, margin: "16px 0" }}>{money(p.priceCents, p.currency)}</div>
            <p style={{ fontSize: 14, color: p.available > 0 ? "#187a30" : "#b00000" }}>
                {p.available > 0 ? `有货 · 库存 ${p.available}` : "暂时缺货"}
            </p>
            <p style={{ fontSize: 12, color: "#999", marginTop: 24 }}>SKU: {p.sku}</p>
        </main>
    );
}
