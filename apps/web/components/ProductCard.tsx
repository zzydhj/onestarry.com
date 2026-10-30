import Link from "next/link";
import { mediaUrl, formatMoney } from "@onestarry/core";
import type { CatalogListItem } from "@onestarry/db";

/** 单个商品卡片（首页 / 列表 / 类目 / 品牌页共用）。priority=首屏可见卡片 → 图 eager + fetchPriority high（优化 LCP）。 */
export function ProductCard({ item, priority = false }: { item: CatalogListItem; priority?: boolean }) {
    return (
        <li>
            <Link
                href={`/products/${item.slug}`}
                className="group block overflow-hidden rounded-xl border border-line bg-white transition hover:shadow-md"
            >
                <div className="aspect-square w-full overflow-hidden bg-surface">
                    {item.imageUrl ? (
                        <img
                            src={mediaUrl(item.imageUrl)}
                            alt={item.title}
                            loading={priority ? "eager" : "lazy"}
                            fetchPriority={priority ? "high" : "auto"}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-muted">No image</div>
                    )}
                </div>
                <div className="p-3">
                    <h2 className="truncate text-sm font-medium">{item.title}</h2>
                    <p className="mt-1 line-clamp-1 text-xs text-muted">{item.description}</p>
                    <div className="mt-2 text-sm font-semibold text-accent">{formatMoney(item.priceCents, item.currency)}</div>
                </div>
            </Link>
        </li>
    );
}
