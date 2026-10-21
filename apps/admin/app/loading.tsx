import { PageSkeleton } from "@onestarry/ui";

/**
 * 后台全站加载骨架：放在 app/ 根下，所有没有自己 loading.tsx 的子路由都会用它。
 * 点菜单 → 立刻出骨架，数据到了再换成真内容。后台每页都要查库（force-dynamic），
 * 这 1–3 秒原本是完全没有反馈的。
 */
export default function AdminLoading() {
    return <PageSkeleton rows={6} />;
}
