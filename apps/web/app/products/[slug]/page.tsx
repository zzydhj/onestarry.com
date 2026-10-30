import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { jsonLdScript, mediaUrl, SITE_ORIGIN, formatMoney } from "@onestarry/core";
import { getProductById, getSeoMeta, listActiveProductSlugs, listApprovedReviews, listProductImages, resolveSlug } from "@onestarry/db";
import { Button, Input } from "@onestarry/ui";
import { addToCartAction } from "../../cart/actions";
import { applySeoMeta } from "@/lib/seo";
import { RichBody } from "@/components/RichBody";

/**
 * ISR：构建期枚举在售商品预渲染 + 每 60s 后台刷新。
 *
 * 原先 `generateStaticParams` 返回 `[]` 走「按需 ISR」（首请求渲染后存 R2）。2026-10-22 线上取证否掉了这条路：
 * **只有运行时 `set()` 写出来的条目会被判即时过期**——同一个 colo 内逐请求 HIT/STALE 交替，60s 窗口塌成 ~10s；
 * 而由 CI 构建期上传、从不经手 `set()` 的 `/`、`/products` 全程健康（完整证据链见 docs/PERF.md）。
 * 所以这里改成构建期枚举真实 slug，让商品页和首页走同一条已被证明稳定的写入路径。
 */
export const revalidate = 60;

/** 构建期预渲染数量上限：商品数增长后构建时长会线性上升，超出部分退回按需首渲染，不让构建被拖死。 */
const MAX_PRERENDER_SLUGS = 200;

/**
 * 连库取在售商品 slug 预渲染。失败退化为空列表（= 回到按需 ISR）而不是抛错：
 * 少预渲染只是慢一点，构建变红会让所有代码上不了线。
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
    try {
        const rows = await listActiveProductSlugs(getDb());
        return rows.slice(0, MAX_PRERENDER_SLUGS).map((r) => ({ slug: r.slug }));
    } catch (e) {
        console.error("[PDP] 构建期枚举 slug 失败，退化为按需 ISR：", e);
        return [];
    }
}

const SITE = SITE_ORIGIN;

/** 按 slug 解析商品（含 redirect/notfound 三态）。用 React cache 去重：generateMetadata 与页面同请求只查一次。 */
const resolveProduct = cache(async (slug: string) => {
    const db = getDb();
    const res = await resolveSlug(db, { entityType: "product", locale: "en", slug });
    if (!res) return { status: "notfound" } as const;
    if (res.status === "redirect") return { status: "redirect", toSlug: res.toSlug } as const;
    const p = await getProductById(db, res.entityId, "us", "en");
    if (!p) return { status: "notfound" } as const;
    const images = await listProductImages(db, res.entityId);
    const seo = await getSeoMeta(db, { entityType: "product", entityId: res.entityId, locale: "en" });
    const reviews = await listApprovedReviews(db, res.entityId, "en");
    return { status: "ok", p, images, seo, reviews } as const;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const r = await resolveProduct(slug);
    if (r.status !== "ok") return { title: "Product" };
    const { p, images, seo } = r;
    const image = images[0]?.r2Key ? mediaUrl(images[0].r2Key) : undefined;
    const desc = p.description || undefined;
    const base: Metadata = {
        title: p.title,
        description: desc,
        alternates: { canonical: `/products/${slug}` },
        openGraph: {
            title: p.title,
            description: desc,
            url: `${SITE}/products/${slug}`,
            type: "website",
            images: image ? [{ url: image, width: 600, height: 600, alt: p.title }] : undefined,
        },
        twitter: {
            card: image ? "summary_large_image" : "summary",
            title: p.title,
            description: desc,
            images: image ? [image] : undefined,
        },
    };
    return applySeoMeta(base, seo);
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const r = await resolveProduct(slug);
    if (r.status === "notfound") notFound();
    if (r.status === "redirect") permanentRedirect(`/products/${r.toSlug}`);
    const { p, images, reviews } = r;
    const hero = images[0]?.r2Key ? mediaUrl(images[0].r2Key) : null;

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.title,
        description: p.description || undefined,
        sku: p.sku || undefined,
        image: images.length ? images.map((im) => mediaUrl(im.r2Key)) : undefined,
        offers: {
            "@type": "Offer",
            priceCurrency: p.currency,
            price: (p.priceCents / 100).toFixed(2),
            availability: p.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: `${SITE}/products/${slug}`,
        },
    };

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            {/* 标题/描述可来自后台录入与 URL 抓品（远程页面原样入库），必须走转义后的内联 JSON。 */}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
            <Link href="/" className="text-sm text-muted transition hover:text-accent">← All products</Link>
            {hero && <link rel="preload" as="image" href={hero} fetchPriority="high" />}
            {images.length > 0 ? (
                <div className="mt-4">
                    <img
                        src={mediaUrl(images[0]?.r2Key)}
                        alt={p.title}
                        width={600}
                        height={600}
                        fetchPriority="high"
                        className="aspect-square w-full rounded-xl border border-line object-cover"
                    />
                    {images.length > 1 && (
                        <div className="mt-2 flex gap-2">
                            {images.slice(1).map((im) => (
                                <img
                                    key={im.mediaId}
                                    src={mediaUrl(im.r2Key)}
                                    alt=""
                                    width={72}
                                    height={72}
                                    loading="lazy"
                                    className="h-16 w-16 rounded-md border border-line object-cover"
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="mt-4 flex aspect-square w-full items-center justify-center rounded-xl bg-surface text-muted">No image</div>
            )}

            <h1 className="mt-5 text-2xl font-semibold tracking-tight">{p.title}</h1>
            {p.description && <p className="mt-2 text-muted">{p.description}</p>}
            <div className="mt-3 text-2xl font-bold text-accent">{formatMoney(p.priceCents, p.currency)}</div>
            <p className={`mt-2 text-sm ${p.available > 0 ? "text-green-600" : "text-red-600"}`}>
                {p.available > 0 ? `In stock · ${p.available} available` : "Out of stock"}
            </p>
            <p className="mt-6 text-xs text-muted">SKU: {p.sku}</p>

            {p.richBody && (
                <section className="mt-6 border-t border-line pt-5">
                    <h2 className="mb-2 text-base font-semibold">Product details</h2>
                    <RichBody doc={p.richBody} />
                </section>
            )}

            <form action={addToCartAction} className="mt-6 flex max-w-xs items-center gap-3">
                <input type="hidden" name="variantId" value={p.variantId} />
                <label className="text-sm text-muted">
                    Qty
                    <Input
                        type="number"
                        name="qty"
                        min={1}
                        max={p.available || 1}
                        defaultValue={1}
                        className="mt-1 w-20 px-2 py-1.5"
                    />
                </label>
                <Button type="submit" disabled={p.available <= 0}>
                    {p.available > 0 ? "Add to cart" : "Out of stock"}
                </Button>
            </form>

            <section className="mt-10 border-t border-line pt-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold">Customer reviews</h2>
                    {/* 评价页在 `/review/[slug]` 而不是本子树的子段（审查 M2）：本子段有 `loading.tsx` 骨架，
                        把需登录的页挂进来就会让它的未登录 `redirect` 被软成 HTTP 200（理由写在页文件头注）。*/}
                    <Link href={`/review/${slug}`} className="text-sm text-accent hover:underline">
                        Write a review
                    </Link>
                </div>
                {reviews.count === 0 ? (
                    <p className="mt-2 text-sm text-muted">No reviews yet. Be the first to review this product.</p>
                ) : (
                    <>
                        <p className="mt-1 text-sm text-muted">
                            {reviews.avg} out of 5 · {reviews.count} review(s)
                        </p>
                        <ul className="mt-4 space-y-4">
                            {reviews.items.map((rv) => (
                                <li key={rv.id} className="rounded-xl border border-line p-4">
                                    <div className="text-sm font-medium">
                                        {rv.rating}★{rv.title ? ` · ${rv.title}` : ""}
                                    </div>
                                    <div className="text-xs text-muted">
                                        {rv.author}
                                        {rv.verifiedPurchase ? " · Verified purchase" : ""} · {rv.createdAt.toISOString().slice(0, 10)}
                                    </div>
                                    {rv.body && <p className="mt-2 text-sm">{rv.body}</p>}
                                    {rv.ownerReply && <p className="mt-2 rounded-lg bg-surface p-2 text-sm text-muted">Seller: {rv.ownerReply}</p>}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </section>
        </div>
    );
}
