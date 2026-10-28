import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { jsonLdScript, SITE_ORIGIN } from "@onestarry/core";
import { browseProducts, loadBrandPageMeta, listCurrentSlugs } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { applySeoMeta } from "@/lib/seo";
import { ProductGrid } from "@/components/ProductGrid";

export const revalidate = 60;

/**
 * 构建期枚举已注册品牌预渲染（与类目页同一形状、同一个理由）：
 * `return []` 等于没修 —— 按需 ISR 的条目被判即时过期，恒 STALE、边缘存不住，每个访客都全额渲染。
 * 2026-10-22 实测本路径冷进 2.3 秒。失败退化成空列表，不把构建变红。docs/PERF.md §3/§7。
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
    try {
        return (await listCurrentSlugs(getDb(), "brand")).map((slug) => ({ slug }));
    } catch (e) {
        console.error("[品牌页] 构建期枚举 slug 失败，退化为按需 ISR：", e);
        return [];
    }
}

const SITE = SITE_ORIGIN;

/**
 * 两次跨洋往返到底：一条 SQL 拿齐 slug 解析 + 品牌 + SEO，再一条拿商品列表。
 * 旧写法 4 次串行（命中历史 slug 时 5 次）→ 线上冷渲染实测 2.3 秒。docs/PERF.md §3。
 */
const loadBrand = cache(async (slug: string) => {
    const db = getDb();
    const meta = await loadBrandPageMeta(db, { slug, locale: "en" });
    // 分开返回字面量判别式，否则下游 d.items 收不窄；无 toSlug 的 redirect 归为 notfound。
    if (meta.status === "redirect" && meta.toSlug) return { status: "redirect", toSlug: meta.toSlug } as const;
    if (meta.status !== "ok") return { status: "notfound" } as const;
    const { items } = await browseProducts(db, { marketCode: "us", locale: "en", brandId: meta.entityId ?? undefined, limit: 100 });
    return { status: "ok", name: meta.name ?? slug, items, seo: meta.seo } as const;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const d = await loadBrand(slug);
    const name = d.status === "ok" ? d.name : slug;
    const base: Metadata = {
        title: `${name} products`,
        description: `Shop ${name} — quality goods shipped worldwide from our own warehouse.`,
        alternates: { canonical: `/brands/${slug}` },
    };
    return applySeoMeta(base, d.status === "ok" ? d.seo : null);
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const d = await loadBrand(slug);
    if (d.status === "notfound") notFound();
    // 历史 slug → 永久重定向 308（审查 M-1，与 PDP/类目同口径）。
    if (d.status === "redirect") permanentRedirect(`/brands/${d.toSlug}`);

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE },
            { "@type": "ListItem", position: 2, name: "All products", item: `${SITE}/products` },
            { "@type": "ListItem", position: 3, name: d.name, item: `${SITE}/brands/${slug}` },
        ],
    };

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }} />
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">{d.name}</h1>
            <ProductGrid items={d.items} emptyLabel="No products from this brand yet." />
        </div>
    );
}
