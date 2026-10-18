import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, getProductById, listProductImages, resolveSlug } from "@onestarry/db";
import { placeOrder } from "./actions";

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
    const images = await listProductImages(db, res.entityId);

    return (
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <Link href="/" style={{ color: "#666", fontSize: 14 }}>← 全部商品</Link>
            {images.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                    <img
                        src={mediaUrl(images[0]?.r2Key)}
                        alt={p.title}
                        width={600}
                        height={600}
                        loading="lazy"
                        style={{ width: "100%", maxWidth: 480, height: "auto", border: "1px solid #eee", borderRadius: 6 }}
                    />
                    {images.length > 1 && (
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            {images.slice(1).map((im) => (
                                <img
                                    key={im.mediaId}
                                    src={mediaUrl(im.r2Key)}
                                    alt=""
                                    width={72}
                                    height={72}
                                    loading="lazy"
                                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4, border: "1px solid #eee" }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div
                    style={{ marginTop: 12, width: "100%", maxWidth: 480, aspectRatio: "1 / 1", background: "#f3f4f6", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa" }}
                >
                    暂无图片
                </div>
            )}
            <h1 style={{ fontSize: 26, margin: "12px 0 4px" }}>{p.title}</h1>
            <p style={{ color: "#666" }}>{p.description}</p>
            <div style={{ fontSize: 24, fontWeight: 700, margin: "16px 0" }}>{money(p.priceCents, p.currency)}</div>
            <p style={{ fontSize: 14, color: p.available > 0 ? "#187a30" : "#b00000" }}>
                {p.available > 0 ? `有货 · 库存 ${p.available}` : "暂时缺货"}
            </p>
            <p style={{ fontSize: 12, color: "#999", marginTop: 24 }}>SKU: {p.sku}</p>

            <form action={placeOrder} style={{ marginTop: 20, display: "grid", gap: 10, maxWidth: 320 }}>
                <input type="hidden" name="variantId" value={p.variantId} />
                <label style={{ fontSize: 13, color: "#555" }}>
                    邮箱
                    <input type="email" name="email" defaultValue="guest@example.com" style={{ width: "100%", marginTop: 4, padding: 8 }} />
                </label>
                <label style={{ fontSize: 13, color: "#555" }}>
                    数量
                    <input type="number" name="qty" min={1} max={p.available || 1} defaultValue={1} style={{ width: 80, marginTop: 4, padding: 8 }} />
                </label>
                <button type="submit" disabled={p.available <= 0} style={{ padding: 10, cursor: p.available > 0 ? "pointer" : "not-allowed" }}>
                    {p.available > 0 ? "下单（MVP 演示）" : "缺货"}
                </button>
            </form>
        </main>
    );
}
