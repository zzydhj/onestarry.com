import { PageSkeleton } from "@onestarry/ui";

/** 结账页要查购物车与实时价格（force-dynamic），先出骨架避免"点了没反应"。 */
export default function Loading() {
    return <PageSkeleton rows={7} />;
}
