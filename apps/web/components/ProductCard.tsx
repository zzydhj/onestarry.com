import Link from "next/link";
import { mediaUrl } from "@onestarry/core";
import type { CatalogListItem } from "@onestarry/db";
import { money } from "@/lib/format";

/** 单个商品卡片（首页 / 列表 / 类目 / 品牌页共用）。 */
export function ProductCard({ item }: { item: CatalogListItem }) {
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
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-muted">No image</div>
                    )}
                </div>
                <div className="p-3">
                    <h2 className="truncate text-sm font-medium">{item.title}</h2>
                    <p className="mt-1 line-clamp-1 text-xs text-muted">{item.description}</p>
                    <div className="mt-2 text-sm font-semibold text-accent">{money(item.priceCents, item.currency)}</div>
                </div>
            </Link>
        </li>
    );
}
