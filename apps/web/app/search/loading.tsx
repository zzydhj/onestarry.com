import { PageSkeleton } from "@onestarry/ui";

/** 搜索结果页每次都要查库（搜索词多变，不做边缘缓存），先出骨架。 */
export default function Loading() {
    return <PageSkeleton rows={6} />;
}
