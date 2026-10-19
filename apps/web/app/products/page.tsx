import type { Metadata } from "next";
import { browseProducts } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { ProductGrid } from "@/components/ProductGrid";

export const revalidate = 60;

export const metadata: Metadata = {
    title: "All products",
    description: "Browse the full catalog of quality goods shipped worldwide from our own warehouse.",
    alternates: { canonical: "/products" },
};

export default async function ProductsPage() {
    const { items } = await browseProducts(getDb(), { marketCode: "us", locale: "en", limit: 100 });
    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">All products</h1>
            <ProductGrid items={items} />
        </div>
    );
}
