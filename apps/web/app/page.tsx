import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { connection } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, listProductsForMarket } from "@onestarry/db";

export const metadata: Metadata = {
    title: { absolute: "onestarry — Shop quality goods, shipped worldwide" },
    description: "Browse our catalog of quality goods shipped worldwide from our own warehouse.",
    alternates: { canonical: "/" },
};

const SITE_JSONLD = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "onestarry",
    url: "https://onestarry.com",
    publisher: { "@type": "Organization", name: "onestarry", url: "https://onestarry.com" },
};

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** 商品列表数据缓存：60s 内命中 R2 数据缓存、不查库（B 方案对无参数静态页的等价实现）。 */
const getHomeProducts = unstable_cache(
    async () => {
        const { env } = getCloudflareContext();
        const db = createDb(env.HYPERDRIVE.connectionString);
        return await listProductsForMarket(db, "us", "en");
    },
    ["home", "products"],
    { revalidate: 60 },
);

export default async function Home() {
    // connection() 让本路由动态渲染（不在构建期预渲染，否则 getCloudflareContext 在 SSG 抛错）；
    // 商品列表仍走上面的 unstable_cache → 命中 R2、60s 不查库。
    await connection();
    const items = await getHomeProducts();

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSONLD) }} />
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">Shop</h1>
            {items.length === 0 ? (
                <p className="text-muted">No products yet.</p>
            ) : (
                <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                    {items.map((it) => (
                        <li key={it.productId}>
                            <Link
                                href={`/products/${it.slug}`}
                                className="group block overflow-hidden rounded-xl border border-line bg-white transition hover:shadow-md"
                            >
                                <div className="aspect-square w-full overflow-hidden bg-surface">
                                    {it.imageUrl ? (
                                        <img
                                            src={mediaUrl(it.imageUrl)}
                                            alt={it.title}
                                            loading="lazy"
                                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-sm text-muted">No image</div>
                                    )}
                                </div>
                                <div className="p-3">
                                    <h2 className="truncate text-sm font-medium">{it.title}</h2>
                                    <p className="mt-1 line-clamp-1 text-xs text-muted">{it.description}</p>
                                    <div className="mt-2 text-sm font-semibold text-accent">{money(it.priceCents, it.currency)}</div>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
