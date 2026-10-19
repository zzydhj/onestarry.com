import type { CatalogListItem } from "@onestarry/db";
import { ProductCard } from "./ProductCard";

/** 商品网格 + 空态。首页 / 列表 / 类目 / 品牌页共用。 */
export function ProductGrid({ items, emptyLabel = "No products yet." }: { items: CatalogListItem[]; emptyLabel?: string }) {
    if (items.length === 0) return <p className="text-muted">{emptyLabel}</p>;
    return (
        <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
                <ProductCard key={it.productId} item={it} />
            ))}
        </ul>
    );
}
