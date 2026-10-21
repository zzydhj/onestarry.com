import { PageSkeleton } from "@onestarry/ui";

/** 我的订单：读会话 + 查库，先出骨架。 */
export default function Loading() {
    return <PageSkeleton rows={5} />;
}
