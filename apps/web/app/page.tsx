import type { Metadata } from "next";
import Link from "next/link";
import { jsonLdScript, SITE_NAME, SITE_ORIGIN } from "@onestarry/core";
import { listCategoriesWithSlug, listProductsForMarket } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { ProductGrid } from "@/components/ProductGrid";

// 整页 ISR（与 PDP 同级）：构建期用 CI 注入的 DATABASE_URL 预渲染真实首页存进 R2；运行期每 60s 后台刷新。
export const revalidate = 60;

export const metadata: Metadata = {
    title: { absolute: `${SITE_NAME} — Shop quality goods, shipped worldwide` },
    description: "Browse our catalog of quality goods shipped worldwide from our own warehouse.",
    alternates: { canonical: "/" },
};

const SITE_JSONLD = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_ORIGIN,
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
};

export default async function Home() {
    const db = getDb();
    const [items, cats] = await Promise.all([listProductsForMarket(db, "us", "en"), listCategoriesWithSlug(db)]);
    const topCats = cats.filter((c) => c.level === 1 && c.urlSlug).slice(0, 6);

    return (
        <div>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(SITE_JSONLD) }} />

            {/* Hero */}
            <section className="border-b border-line bg-surface">
                <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:py-20">
                    <h1 className="text-4xl font-semibold tracking-tight text-brand sm:text-5xl">Quality goods, shipped worldwide</h1>
                    <p className="mx-auto mt-4 max-w-xl text-muted">Direct from our own warehouse to your door — hand-checked, fairly priced, delivered.</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link href="/products" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">
                            Shop all
                        </Link>
                        <Link href="/categories" className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-brand transition hover:border-accent">
                            Browse categories
                        </Link>
                    </div>
                </div>
            </section>

            {/* 分类入口 */}
            {topCats.length > 0 && (
                <section className="mx-auto max-w-5xl px-4 py-12">
                    <h2 className="mb-5 text-lg font-semibold tracking-tight text-brand">Shop by category</h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {topCats.map((c) => (
                            <Link
                                key={c.id}
                                href={`/categories/${c.urlSlug}`}
                                className="rounded-xl border border-line bg-white p-6 text-center font-medium text-brand transition hover:border-accent hover:shadow-sm"
                            >
                                {c.name}
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            {/* 精选商品 */}
            <section className="mx-auto max-w-5xl px-4 py-12">
                <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-lg font-semibold tracking-tight text-brand">Featured products</h2>
                    <Link href="/products" className="text-sm text-accent hover:underline">
                        View all →
                    </Link>
                </div>
                <ProductGrid items={items.slice(0, 8)} emptyLabel="No products yet — check back soon." />
            </section>

            {/* 信任条 */}
            <section className="border-t border-line">
                <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-4 py-10 text-center sm:grid-cols-3">
                    <div>
                        <div className="text-sm font-semibold text-brand">Ships worldwide</div>
                        <p className="mt-1 text-xs text-muted">From our own warehouse, tracked door to door.</p>
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-brand">Secure checkout</div>
                        <p className="mt-1 text-xs text-muted">Encrypted payment with buyer-friendly returns.</p>
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-brand">Quality guarantee</div>
                        <p className="mt-1 text-xs text-muted">Every item hand-checked before dispatch.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
