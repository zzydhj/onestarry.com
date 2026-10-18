import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, listProductsForMarket } from "@onestarry/db";

export const dynamic = "force-dynamic";

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function Home() {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const items = await listProductsForMarket(db, "us", "en");

    return (
        <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <h1 style={{ fontSize: 24 }}>onestarry · 商品（US 市场）</h1>
            <p style={{ fontSize: 14 }}>
                <Link href="/cart" style={{ color: "#0366d6", textDecoration: "none" }}>🛒 购物车</Link>
                {" · "}
                <Link href="/account/orders" style={{ color: "#0366d6", textDecoration: "none" }}>我的订单</Link>
            </p>
            {items.length === 0 ? (
                <p style={{ color: "#888" }}>暂无商品。请先运行 <code>pnpm --filter @onestarry/db seed:demo</code>。</p>
            ) : (
                <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                    {items.map((it) => (
                        <li key={it.productId} style={{ border: "1px solid #eee", borderRadius: 10, padding: 16 }}>
                            <Link href={`/products/${it.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
                                {it.imageUrl ? (
                                    <img
                                        src={mediaUrl(it.imageUrl)}
                                        alt={it.title}
                                        loading="lazy"
                                        width={240}
                                        height={160}
                                        style={{ width: "100%", aspectRatio: "3 / 2", objectFit: "cover", borderRadius: 8, marginBottom: 10, background: "#f3f4f6" }}
                                    />
                                ) : (
                                    <div style={{ width: "100%", aspectRatio: "3 / 2", background: "#f3f4f6", borderRadius: 8, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 13 }}>无图</div>
                                )}
                                <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>{it.title}</h2>
                                <p style={{ margin: "0 0 10px", color: "#666", fontSize: 13 }}>{it.description}</p>
                                <div style={{ fontWeight: 600 }}>{money(it.priceCents, it.currency)}</div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
