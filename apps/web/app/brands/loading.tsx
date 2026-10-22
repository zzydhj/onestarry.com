import { GridSkeleton } from "@onestarry/ui";

/**
 * 品牌明细页取数串 4 次跨洋往返（slug → 品牌 → 商品 → SEO），条目过期时要等 1–4 秒。
 * 没有这一层时 Next 会继续显示上一页且全程无反馈 —— 体感是“点了没反应”。
 * 2026-10-22 用户报“从品牌列表页跳到具体品牌页很卡”，根因的一半在这里。docs/PERF.md §3。
 */
export default function Loading() {
    return <GridSkeleton count={8} />;
}
