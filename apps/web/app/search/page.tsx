import type { Metadata } from "next";
import { searchProducts } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { ProductGrid } from "@/components/ProductGrid";

export const dynamic = "force-dynamic"; // 搜索词多变、按需查库（Hyperdrive 短缓存兜底），不做边缘缓存

export const metadata: Metadata = {
    title: "Search",
    description: "Search the onestarry catalog.",
    robots: { index: false, follow: false },
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const { q = "" } = await searchParams;
    const query = q.trim();
    const { items, total } = query
        ? await searchProducts(getDb(), { marketCode: "us", locale: "en", q: query, limit: 60 })
        : { items: [], total: 0 };

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">Search</h1>

            <form action="/search" method="get" className="mt-4 flex max-w-md gap-2">
                <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search products…"
                    className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
                    Search
                </button>
            </form>

            {!query ? (
                <p className="mt-6 text-sm text-muted">Type a keyword to search.</p>
            ) : total === 0 ? (
                <p className="mt-6 text-sm text-muted">No results for “{query}”.</p>
            ) : (
                <>
                    <p className="mt-6 text-sm text-muted">
                        {total} result{total === 1 ? "" : "s"} for “{query}”
                    </p>
                    <div className="mt-4">
                        <ProductGrid items={items} />
                    </div>
                </>
            )}
        </div>
    );
}
