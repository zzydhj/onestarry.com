import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { mediaUrl } from "@onestarry/core";
import { createDb, inventory, listProductImages, productTranslations, productVariants, products } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { setProductStatusAction, updateBasePriceAction, updateInventoryAction } from "./actions";
import { ImageUploader } from "./ImageUploader";
import { RichTextEditor } from "./RichTextEditor";

export const dynamic = "force-dynamic";

/** 后台商品详情（受保护）：展示变体，每个变体可改基价（→触发重算+写时自派发）。 */
export default async function AdminProductDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await requireAdmin();

    const db = createDb(env.HYPERDRIVE.connectionString);
    const product = (await db.select().from(products).where(eq(products.id, id)).limit(1))[0];
    if (!product) notFound();
    const [title] = await db
        .select({ title: productTranslations.title, richBody: productTranslations.richBody })
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
        <main className="mx-auto max-w-4xl px-4 py-8">
            <Link href="/products" className="text-sm text-muted transition hover:text-accent">← 返回商品列表</Link>
            <h1 className="mt-2 text-xl font-semibold">{title?.title ?? "（无标题）"}</h1>
            <p className="mt-1 text-sm text-muted">状态：{product.status} · ID：{product.id}</p>

            <form action={setProductStatusAction} className="mt-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="productId" value={product.id} />
                <span className="text-sm">上架状态：</span>
                <select name="status" defaultValue={product.status} className="rounded-md border border-line px-3 py-1.5 text-sm">
                    <option value="draft">草稿（下架）</option>
                    <option value="active">已上架</option>
                    <option value="archived">已归档</option>
                </select>
                <button type="submit" className="rounded-lg border border-line px-4 py-1.5 text-sm font-medium transition hover:bg-surface">更新状态</button>
            </form>

            <h2 className="mt-8 text-base font-semibold">商品图片</h2>
            <div className="mt-3">
                <ImageUploader
                    productId={product.id}
                    images={images.map((im) => ({ mediaId: im.mediaId, url: mediaUrl(im.r2Key) }))}
                />
            </div>

            <h2 className="mt-8 text-base font-semibold">变体、基价与库存（改价会触发全包价重算）</h2>
            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                    <thead className="border-b border-line text-left text-muted">
                        <tr>
                            <th className="px-4 py-2 font-medium">SKU</th>
                            <th className="px-4 py-2 font-medium">基价(USD)</th>
                            <th className="px-4 py-2 font-medium">主变体</th>
                            <th className="px-4 py-2 font-medium">库存(on_hand)</th>
                            <th className="px-4 py-2 font-medium">成本</th>
                        </tr>
                    </thead>
                    <tbody>
                        {variants.map((v) => (
                            <tr key={v.id} className="border-b border-line last:border-0">
                                <td className="px-4 py-2 font-mono text-xs">{v.sku}</td>
                                <td className="px-4 py-2">
                                    <form action={updateBasePriceAction} className="flex gap-2">
                                        <input type="hidden" name="variantId" value={v.id} />
                                        <input type="hidden" name="productId" value={product.id} />
                                        <input
                                            name="price"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            defaultValue={v.basePriceCents != null ? (v.basePriceCents / 100).toFixed(2) : ""}
                                            className="w-24 rounded-md border border-line px-2 py-1 text-sm"
                                        />
                                        <button type="submit" className="rounded-md border border-line px-3 py-1 text-xs transition hover:bg-surface">保存</button>
                                    </form>
                                </td>
                                <td className="px-4 py-2">{v.isPrimary ? "★" : ""}</td>
                                <td className="px-4 py-2">
                                    <form action={updateInventoryAction} className="flex gap-2">
                                        <input type="hidden" name="variantId" value={v.id} />
                                        <input type="hidden" name="productId" value={product.id} />
                                        <input name="onHand" type="number" min="0" step="1" defaultValue={stockMap.get(v.id)?.onHand ?? 0} className="w-20 rounded-md border border-line px-2 py-1 text-sm" />
                                        <button type="submit" className="rounded-md border border-line px-3 py-1 text-xs transition hover:bg-surface">保存</button>
                                    </form>
                                    <div className="mt-1 text-xs text-muted">可用 {stockMap.get(v.id)?.available ?? 0}</div>
                                </td>
                                <td className="px-4 py-2 text-xs text-muted">
                                    成本 {v.costCents != null ? `$${(v.costCents / 100).toFixed(2)}` : "—"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <h2 className="mt-8 text-base font-semibold">图文详情（富文本，存结构化 JSON）</h2>
            <div className="mt-3">
                <RichTextEditor productId={product.id} initial={(title?.richBody as Record<string, unknown> | null) ?? null} />
            </div>
        </main>
    );
}
