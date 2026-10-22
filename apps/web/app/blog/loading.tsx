import { PageSkeleton } from "@onestarry/ui";

/** 博文列表：整页 ISR 60 秒，边缘条目过期那一发要把旧页先端出来，骨架负责让等待可见。 */
export default function Loading() {
    return <PageSkeleton rows={6} />;
}
