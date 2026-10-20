import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { SITE_ORIGIN } from "@onestarry/core";
import { browseProducts, getBrandById, getSeoMeta, resolveSlug } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { applySeoMeta } from "@/lib/seo";
import { ProductGrid } from "@/components/ProductGrid";

export const revalidate = 60;
export async function generateStaticParams() {
    return [];
}

const SITE = SITE_ORIGIN;

const loadBrand = cache(async (slug: string) => {
    const db = getDb();
    const res = await resolveSlug(db, { entityType: "brand", locale: "en", slug });
    if (!res) return { status: "notfound" } as const;
    if (res.status === "redirect") return { status: "redirect", toSlug: res.toSlug } as const;
    const brand = await getBrandById(db, res.entityId);
    if (!brand) return { status: "notfound" } as const;
    const { items } = await browseProducts(db, { marketCode: "us", locale: "en", brandId: res.entityId, limit: 100 });
    const seo = await getSeoMeta(db, { entityType: "brand", entityId: res.entityId, locale: "en" });
    return { status: "ok", name: brand.name, items, seo } as const;
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
    if (d.status === "redirect") redirect(`/brands/${d.toSlug}`);

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
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">{d.name}</h1>
            <ProductGrid items={d.items} emptyLabel="No products from this brand yet." />
        </div>
    );
}
