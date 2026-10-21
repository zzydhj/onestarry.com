import { PageSkeleton } from "@onestarry/ui";

/** 购物车要按变体实时取价与库存（force-dynamic），先出骨架。 */
export default function Loading() {
    return <PageSkeleton rows={4} />;
}
