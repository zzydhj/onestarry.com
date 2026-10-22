import type { Metadata } from "next";
import { Suspense } from "react";
import { searchProducts } from "@onestarry/db";
import { SITE_NAME } from "@onestarry/core";
import { PageSkeleton } from "@onestarry/ui";
import { getDb } from "@/lib/db";
import { ProductGrid } from "@/components/ProductGrid";
import { SearchBox } from "./SearchBox";

export const dynamic = "force-dynamic"; // 搜索词多变、按需查库（Hyperdrive 短缓存兜底），不做边缘缓存

export const metadata: Metadata = {
    title: "Search",
    description: `Search the ${SITE_NAME} catalog.`,
    robots: { index: false, follow: false },
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
    const { q = "" } = await searchParams;
    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">Search</h1>
            <SearchBox initial={q} />
            {/* 结果单独一个 Suspense 边界：软导航时只换这一块，输入框不重挂（焦点不丢）。 */}
            <Suspense fallback={<PageSkeleton rows={4} />}>
                <Results q={q} />
            </Suspense>
        </div>
    );
}

/** 结果区（一次 SQL 拿行 + 总数）。 */
async function Results({ q }: { q: string }) {
    const query = q.trim();
    const { items, total } = query
        ? await searchProducts(getDb(), { marketCode: "us", locale: "en", q: query, limit: 60 })
        : { items: [], total: 0 };

    if (!query) return <p className="mt-6 text-sm text-muted">Type a keyword to search.</p>;
    if (total === 0) return <p className="mt-6 text-sm text-muted">No results for “{query}”.</p>;

    return (
        <>
            <p className="mt-6 text-sm text-muted">
                {total} result{total === 1 ? "" : "s"} for “{query}”
            </p>
            <div className="mt-4">
                <ProductGrid items={items} />
            </div>
        </>
    );
}
