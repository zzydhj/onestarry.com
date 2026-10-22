import { GridSkeleton } from "@onestarry/ui";

/** 商品列表页与 PDP 共用这一层：两者都是整页 ISR，边缘条目过期时要把访客挂住 1–2 秒。 */
export default function Loading() {
    return <GridSkeleton count={8} />;
}
