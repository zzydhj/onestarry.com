import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { browseProducts, getCategoryById, getCategorySubtreeIds, getSeoMeta, resolveSlug } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { applySeoMeta } from "@/lib/seo";
import { ProductGrid } from "@/components/ProductGrid";

export const revalidate = 60;
export async function generateStaticParams() {
    return [];
}

const SITE = "https://onestarry.com";

const loadCategory = cache(async (slug: string) => {
    const db = getDb();
    const res = await resolveSlug(db, { entityType: "category", locale: "en", slug });
    if (!res) return { status: "notfound" } as const;
    if (res.status === "redirect") return { status: "redirect", toSlug: res.toSlug } as const;
    const cat = await getCategoryById(db, res.entityId);
    if (!cat) return { status: "notfound" } as const;
    const ids = await getCategorySubtreeIds(db, res.entityId);
    const { items } = await browseProducts(db, { marketCode: "us", locale: "en", categoryIds: ids, limit: 100 });
    const seo = await getSeoMeta(db, { entityType: "category", entityId: res.entityId, locale: "en" });
    return { status: "ok", name: cat.name, items, seo } as const;
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
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">{d.name}</h1>
            <ProductGrid items={d.items} emptyLabel="No products in this category yet." />
        </div>
    );
}
