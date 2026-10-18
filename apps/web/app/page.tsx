import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, listProductsForMarket } from "@onestarry/db";

export const dynamic = "force-dynamic";

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function Home() {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const items = await listProductsForMarket(db, "us", "en");

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">全部商品</h1>
            {items.length === 0 ? (
                <p className="text-muted">暂无商品。</p>
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
                                        <div className="flex h-full w-full items-center justify-center text-sm text-muted">无图</div>
                                    )}
                                </div>
                                <div className="p-3">
                                    <h2 className="truncate text-sm font-medium">{it.title}</h2>
                                    <p className="mt-1 line-clamp-1 text-xs text-muted">{it.description}</p>
                                    <div className="mt-2 text-sm font-semibold text-brand">{money(it.priceCents, it.currency)}</div>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
