import { PageSkeleton } from "@onestarry/ui";

/** PDP 不是网格，单独盖一层，避免父段 app/products/loading.tsx 的卡片骨架闪在商品页上。 */
export default function Loading() {
    return <PageSkeleton rows={5} />;
}
