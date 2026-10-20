import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, getProductById, getSeoMeta, listProductImages, resolveSlug } from "@onestarry/db";
import { Button, Input } from "@onestarry/ui";
import { addToCartAction } from "../../cart/actions";
import { applySeoMeta } from "@/lib/seo";
import { RichBody } from "./RichBody";

// ISR（方案 B）：动态路由无 generateStaticParams → 构建期不预渲染，首请求才渲染并存入 R2，每 60s 后台刷新。
// 商品页对所有人一致、慢变、无写副作用 → 符合可缓存判据。价格/库存最多陈旧 60s（电商可接受）。
export const revalidate = 60;

/**
 * 返回空列表 → 所有 slug 走「按需 ISR」：首个请求渲染并缓存到 R2，之后命中缓存；
 * 构建期无参数需预渲染 → 不会触发 getCloudflareContext 在 build 期报错。百万商品无需枚举。
 * （关键：Next 15 里光有 revalidate 不足以让 [slug] 路由进入 ISR，必须配 generateStaticParams 才是静态/ISR 路由。）
 */
export async function generateStaticParams() {
    return [];
}

const SITE = "https://onestarry.com";

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** 按 slug 解析商品（含 redirect/notfound 三态）。用 React cache 去重：generateMetadata 与页面同请求只查一次。 */
const resolveProduct = cache(async (slug: string) => {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const res = await resolveSlug(db, { entityType: "product", locale: "en", slug });
    if (!res) return { status: "notfound" } as const;
    if (res.status === "redirect") return { status: "redirect", toSlug: res.toSlug } as const;
    const p = await getProductById(db, res.entityId, "us", "en");
    if (!p) return { status: "notfound" } as const;
    const images = await listProductImages(db, res.entityId);
    const seo = await getSeoMeta(db, { entityType: "product", entityId: res.entityId, locale: "en" });
    return { status: "ok", p, images, seo } as const;
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
    const { p, images } = r;
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
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
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
            <div className="mt-3 text-2xl font-bold text-accent">{money(p.priceCents, p.currency)}</div>
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
        </div>
    );
}
