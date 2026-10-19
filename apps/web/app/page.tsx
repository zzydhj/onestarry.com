import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, listProductsForMarket } from "@onestarry/db";

// 整页 ISR（与 PDP 同级）：构建期用 CI 注入的 DATABASE_URL 预渲染真实首页存进 R2；
// 运行期每 60s 到期后首个访问秒回旧页 + 后台用 Hyperdrive 绑定刷新。
export const revalidate = 60;

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

/** 连接串：运行期用 Hyperdrive 绑定；构建期（SSG 预渲染）无 Workers 上下文 → 回退到 CI 注入的 DATABASE_URL（Neon 池化）。 */
function dbUrl(): string {
    try {
        return getCloudflareContext().env.HYPERDRIVE.connectionString;
    } catch {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("构建期缺少 DATABASE_URL：请在 Workers Builds 环境变量配置 Neon 池化连接串");
        return url;
    }
}

export default async function Home() {
    const items = await listProductsForMarket(createDb(dbUrl()), "us", "en");

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
