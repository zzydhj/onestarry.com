import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { jsonLdScript, SITE_ORIGIN } from "@onestarry/core";
import { browseProducts, loadCategoryPageMeta, listCurrentSlugs } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { applySeoMeta } from "@/lib/seo";
import { ProductGrid } from "@/components/ProductGrid";

export const revalidate = 60;

/**
 * 构建期枚举已发布类目预渲染。
 *
 * 原先这里写的是 `return []` —— 那是“有函数但等于没修”：走按需 ISR 时，运行时 `set()`
 * 写回的条目会被判即时过期 → 恒 `STALE`、边缘存不住，**每个访客都付一次全额渲染**。
 * 2026-10-22 实测本路径冷进 2.3–4.3 秒（同站预渲染的 PDP 只要 1.2 秒、边缘命中 0.11 秒）。
 * 失败退化成空列表而不是抛错：少预渲染只是慢，构建变红会让所有代码上不了线。docs/PERF.md §3/§7。
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
    try {
        return (await listCurrentSlugs(getDb(), "category")).map((slug) => ({ slug }));
    } catch (e) {
        console.error("[类目页] 构建期枚举 slug 失败，退化为按需 ISR：", e);
        return [];
    }
}

const SITE = SITE_ORIGIN;

/**
 * 两次跨洋往返到底：一条 SQL 拿齐 slug 解析 + 类目 + 子树 + SEO（loadCategoryPageMeta），
 * 再一条拿商品列表（browseProducts，列表唯一真源，不在这里复制一份价格 join）。
 * 旧写法是 5 次串行（命中历史 slug 时 6 次）→ 线上冷渲染实测 2.3–4.3 秒。docs/PERF.md §3。
 * React cache 负责同请求去重：generateMetadata 与页面只跑一次。
 */
const loadCategory = cache(async (slug: string) => {
    const db = getDb();
    const meta = await loadCategoryPageMeta(db, { slug, locale: "en" });
    // 两个早退分支各自返回字面量判别式：写成 { status: meta.status } 会让 TS 无法收窄后面 d.items 的类型。
    // 无 toSlug 的 redirect 当成 notfound：宁返 404，也不 redirect 到 /categories/undefined。
    if (meta.status === "redirect" && meta.toSlug) return { status: "redirect", toSlug: meta.toSlug } as const;
    if (meta.status !== "ok") return { status: "notfound" } as const;
    const { items } = await browseProducts(db, { marketCode: "us", locale: "en", categoryIds: meta.categoryIds, limit: 100 });
    return { status: "ok", name: meta.name ?? slug, items, seo: meta.seo } as const;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const d = await loadCategory(slug);
    const name = d.status === "ok" ? d.name : slug;
    const base: Metadata = {
        title: name,
        description: `Shop ${name} — quality goods shipped worldwide from our own warehouse.`,
        alternates: { canonical: `/categories/${slug}` },
    };
    return applySeoMeta(base, d.status === "ok" ? d.seo : null);
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const d = await loadCategory(slug);
    if (d.status === "notfound") notFound();
    if (d.status === "redirect") redirect(`/categories/${d.toSlug}`);

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE },
            { "@type": "ListItem", position: 2, name: "All products", item: `${SITE}/products` },
            { "@type": "ListItem", position: 3, name: d.name, item: `${SITE}/categories/${slug}` },
        ],
    };

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }} />
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">{d.name}</h1>
            <ProductGrid items={d.items} emptyLabel="No products in this category yet." />
        </div>
    );
}
