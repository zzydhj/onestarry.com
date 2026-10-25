import Link from "next/link";
import { notFound } from "next/navigation";
import { mediaUrl, PERMISSIONS } from "@onestarry/core";
import { loadAdminProductDetail } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Button, Input, Select, TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";
import { assignCatalogAction, saveSeoMetaAction, setProductStatusAction, updateBasePriceAction, updateInventoryAction } from "./actions";
import { ImageUploader } from "./ImageUploader";
import { RichTextEditor } from "./RichTextEditor";

export const dynamic = "force-dynamic";

/** 后台商品详情（受保护）：展示变体，每个变体可改基价（→触发重算+写时自派发）。 */
export default async function AdminProductDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await requirePermission(PERMISSIONS.productWrite);

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    // 一条 SQL 取回本页要的全部数据。原先是 8 次串行跨洋往返（products → 译文 → 变体 → 库存 →
    // 图片 → SEO → 全量类目 → 全量品牌），那正是“点进来要 6 秒”的来源；并行也救不了（同一
    // max:1 连接会排队）。字段口径与逐处对应关系见 queries/adminProductDetail.ts 顶部注释。
    const detail = await loadAdminProductDetail(db, id);
    if (!detail.found || !detail.id) notFound();
    const product = {
        id: detail.id,
        status: detail.status ?? "draft",
        primaryCategoryId: detail.primaryCategoryId,
        brandId: detail.brandId,
    };

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <Link href="/products" className="text-sm text-muted transition hover:text-accent">← 返回商品列表</Link>
            <h1 className="mt-2 text-xl font-semibold">{detail.title ?? "（无标题）"}</h1>
            <p className="mt-1 text-sm text-muted">状态：{product.status} · ID：{product.id}</p>

            <form action={setProductStatusAction} className="mt-4 flex flex-wrap items-center gap-2">
                <input type="hidden" name="productId" value={product.id} />
                <span className="text-sm">上架状态：</span>
                <Select name="status" defaultValue={product.status} className="py-1.5 text-sm">
                    <option value="draft">草稿（下架）</option>
                    <option value="active">已上架</option>
                    <option value="archived">已归档</option>
                </Select>
                <Button type="submit" variant="secondary">更新状态</Button>
            </form>

            <h2 className="mt-8 text-base font-semibold">分类与品牌（决定商品出现在哪些浏览页）</h2>
            <form action={assignCatalogAction} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="productId" value={product.id} />
                <Select name="categoryId" defaultValue={product.primaryCategoryId ?? ""} className="py-1.5 text-sm">
                    <option value="">（未分类）</option>
                    {detail.categories.map((c) => (
                        <option key={c.id} value={c.id}>{"　".repeat(c.level - 1) + c.name}</option>
                    ))}
                </Select>
                <Select name="brandId" defaultValue={product.brandId ?? ""} className="py-1.5 text-sm">
                    <option value="">（无品牌）</option>
                    {detail.brands.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </Select>
                <Button type="submit" variant="secondary">保存归属</Button>
            </form>

            <h2 className="mt-8 text-base font-semibold">商品图片</h2>
            <div className="mt-3">
                <ImageUploader
                    productId={product.id}
                    images={detail.images.map((im) => ({ mediaId: im.mediaId, url: mediaUrl(im.r2Key) }))}
                />
            </div>

            <h2 className="mt-8 text-base font-semibold">变体、基价与库存（改价会触发全包价重算）</h2>
            <TableFrame className="mt-3">
                <table className="w-full text-sm">
                    <THead>
                        <tr>
                            <Th>SKU</Th>
                            <Th>基价(USD)</Th>
                            <Th>主变体</Th>
                            <Th>库存(on_hand)</Th>
                            <Th>成本</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {detail.variants.map((v) => (
                            <Tr key={v.id}>
                                <Td className="font-mono text-xs">{v.sku}</Td>
                                <Td>
                                    <form action={updateBasePriceAction} className="flex gap-2">
                                        <input type="hidden" name="variantId" value={v.id} />
                                        <input type="hidden" name="productId" value={product.id} />
                                        <Input
                                            name="price"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            defaultValue={v.basePriceCents != null ? (v.basePriceCents / 100).toFixed(2) : ""}
                                            className="w-24 px-2 py-1 text-sm"
                                        />
                                        <Button type="submit" variant="secondary" size="sm">保存</Button>
                                    </form>
                                </Td>
                                <Td>{v.isPrimary ? "★" : ""}</Td>
                                <Td>
                                    <form action={updateInventoryAction} className="flex gap-2">
                                        <input type="hidden" name="variantId" value={v.id} />
                                        <input type="hidden" name="productId" value={product.id} />
                                        <Input name="onHand" type="number" min="0" step="1" defaultValue={v.onHand} className="w-20 px-2 py-1 text-sm" />
                                        <Button type="submit" variant="secondary" size="sm">保存</Button>
                                    </form>
                                    <div className="mt-1 text-xs text-muted">可用 {v.available}</div>
                                </Td>
                                <Td className="text-xs text-muted">
                                    成本 {v.costCents != null ? `$${(v.costCents / 100).toFixed(2)}` : "—"}
                                </Td>
                            </Tr>
                        ))}
                    </tbody>
                </table>
            </TableFrame>

            <h2 className="mt-8 text-base font-semibold">图文详情（富文本，存结构化 JSON）</h2>
            <div className="mt-3">
                <RichTextEditor productId={product.id} initial={(detail.richBody as Record<string, unknown> | null) ?? null} />
            </div>

            <h2 className="mt-8 text-base font-semibold">SEO（覆盖搜索标题/描述；留空则用自动生成）</h2>
            <form action={saveSeoMetaAction} className="mt-3 space-y-3">
                <input type="hidden" name="productId" value={product.id} />
                <div>
                    <label className="block text-sm text-muted">SEO 标题</label>
                    <Input
                        name="seoTitle"
                        defaultValue={detail.seo?.seoTitle ?? ""}
                        maxLength={70}
                        placeholder={detail.title ?? "留空用商品名"}
                        className="mt-1 w-full px-2 py-1.5 text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm text-muted">Meta 描述</label>
                    <textarea
                        name="metaDescription"
                        rows={2}
                        maxLength={160}
                        defaultValue={detail.seo?.metaDescription ?? ""}
                        placeholder="留空用商品描述"
                        className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm text-muted">Canonical URL（可选）</label>
                    <Input
                        name="canonicalUrl"
                        defaultValue={detail.seo?.canonicalUrl ?? ""}
                        placeholder="/products/xxx 或完整 URL"
                        className="mt-1 w-full px-2 py-1.5 text-sm"
                    />
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        name="noindex"
                        defaultChecked={detail.seo?.robots ? (detail.seo.robots as { index?: boolean }).index === false : false}
                    />
                    <span>不让搜索引擎收录（noindex）</span>
                </label>
                <div className="flex items-center gap-3">
                    <Button type="submit" variant="secondary">保存 SEO</Button>
                    <span className="text-xs text-muted">全部留空保存 = 恢复自动生成</span>
                </div>
            </form>
        </main>
    );
}
