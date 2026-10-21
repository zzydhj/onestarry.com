import { PageSkeleton } from "@onestarry/ui";

/** 订单确认页要查订单头/明细/商品行，先出骨架。 */
export default function Loading() {
    return <PageSkeleton rows={5} />;
}
