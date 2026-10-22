import { GridSkeleton } from "@onestarry/ui";

/**
 * 类目明细页取数串 5 次跨洋往返（slug → 类目 → 子树 → 商品 → SEO），条目过期时要等 1–4 秒。
 * 没有这一层时 Next 会继续显示上一页且全程无反馈 —— 体感是“点了没反应”。
 * 2026-10-22 用户报“从分类页跳到具体类目很卡”，根因的一半在这里。docs/PERF.md §3。
 */
export default function Loading() {
    return <GridSkeleton count={8} />;
}
