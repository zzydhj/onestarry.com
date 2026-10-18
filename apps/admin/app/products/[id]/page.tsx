import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { mediaUrl } from "@onestarry/core";
import { createDb, inventory, listProductImages, productTranslations, productVariants, products } from "@onestarry/db";
import { setProductStatusAction, updateBasePriceAction, updateInventoryAction } from "./actions";
import { ImageUploader } from "./ImageUploader";

export const dynamic = "force-dynamic";

/** 后台商品详情（受保护）：展示变体，每个变体可改基价（→触发重算+写时自派发）。 */
export default async function AdminProductDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
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
    const product = (await db.select().from(products).where(eq(products.id, id)).limit(1))[0];
    if (!product) notFound();
    const [title] = await db
        .select({ title: productTranslations.title })
        .from(productTranslations)
        .where(eq(productTranslations.productId, id))
        .limit(1);
    const variants = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id));
    const invRows = variants.length
        ? await db.select().from(inventory).where(inArray(inventory.variantId, variants.map((v) => v.id)))
        : [];
    const stockMap = new Map(invRows.map((r) => [r.variantId, { onHand: r.onHand, available: r.available ?? 0 }]));
    const images = await listProductImages(db, id);

    return (
        <main style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/products">← 返回商品列表</Link></p>
            <h1 style={{ fontSize: 22 }}>{title?.title ?? "（无标题）"}</h1>
            <p style={{ color: "#888", fontSize: 13 }}>状态：{product.status} · ID：{product.id}</p>

            <form action={setProductStatusAction} style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
                <input type="hidden" name="productId" value={product.id} />
                <span>上架状态：</span>
                <select name="status" defaultValue={product.status}>
                    <option value="draft">草稿（下架）</option>
                    <option value="active">已上架</option>
                    <option value="archived">已归档</option>
                </select>
                <button type="submit">更新状态</button>
            </form>

            <h2 style={{ fontSize: 16, marginTop: 24 }}>商品图片</h2>
            <ImageUploader
                productId={product.id}
                images={images.map((im) => ({ mediaId: im.mediaId, url: mediaUrl(im.r2Key) }))}
            />

            <h2 style={{ fontSize: 16, marginTop: 24 }}>变体、基价与库存（改价会触发全包价重算）</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                        <th style={{ padding: "6px 8px" }}>SKU</th>
                        <th style={{ padding: "6px 8px" }}>基价(USD)</th>
                        <th style={{ padding: "6px 8px" }}>主变体</th>
                        <th style={{ padding: "6px 8px" }}>库存(on_hand)</th>
                        <th style={{ padding: "6px 8px" }}>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {variants.map((v) => (
                        <tr key={v.id} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 12 }}>{v.sku}</td>
                            <td style={{ padding: "6px 8px" }}>
                                <form action={updateBasePriceAction} style={{ display: "flex", gap: 6 }}>
                                    <input type="hidden" name="variantId" value={v.id} />
                                    <input type="hidden" name="productId" value={product.id} />
                                    <input
                                        name="price"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        defaultValue={v.basePriceCents != null ? (v.basePriceCents / 100).toFixed(2) : ""}
                                        style={{ width: 100 }}
                                    />
                                    <button type="submit">保存</button>
                                </form>
                            </td>
                            <td style={{ padding: "6px 8px" }}>{v.isPrimary ? "★" : ""}</td>
                            <td style={{ padding: "6px 8px" }}>
                                <form action={updateInventoryAction} style={{ display: "flex", gap: 6 }}>
                                    <input type="hidden" name="variantId" value={v.id} />
                                    <input type="hidden" name="productId" value={product.id} />
                                    <input name="onHand" type="number" min="0" step="1" defaultValue={stockMap.get(v.id)?.onHand ?? 0} style={{ width: 72 }} />
                                    <button type="submit">保存</button>
                                </form>
                                <div style={{ color: "#888", fontSize: 11 }}>可用 {stockMap.get(v.id)?.available ?? 0}</div>
                            </td>
                            <td style={{ padding: "6px 8px", color: "#888", fontSize: 12 }}>
                                成本 {v.costCents != null ? `$${(v.costCents / 100).toFixed(2)}` : "—"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </main>
    );
}
