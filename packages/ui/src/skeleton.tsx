/**
 * 路由级骨架屏：给 `loading.tsx` 用。
 *
 * 为什么值得做：动态页要等 1–3 秒（跨区数据库往返），没有即时反馈时人的体感是
 * “点了没反应”→ 重复点、以为挂了。先出骨架、数据到了再换真内容，
 * 等待时间一秒没少，但**可感知延迟从“全程无反馈”变成“立刻有响应”**。
 * 刻意不带文字，避免读屏器播报无意义内容（aria-busy 已表达状态）。
 */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="mx-auto max-w-4xl px-4 py-8" aria-busy="true">
            <div className="h-7 w-40 animate-pulse rounded-lg bg-surface" />
            <div className="mt-6 space-y-3">
                {Array.from({ length: rows }).map((_, i) => (
                    <div key={i} className="h-11 w-full animate-pulse rounded-lg bg-surface" />
                ))}
            </div>
        </div>
    );
}

/**
 * 商品网格骨架：给 /products、/categories、/brands 的 `loading.tsx` 用。
 *
 * 形状必须与 ProductGrid + ProductCard 一致（同样的容器宽度、列数、间距、
 * aspect-square 图 + 三行文字）——否则骨架消失时整页会跳一下，那比多等半秒更
 * 让人觉得“卡”。2026-10-22：用户报“从品牌列表页跳到具体品牌页很卡”，而这两个
 * 浏览类路由从来没挂 loading.tsx（Next 在没有 Suspense 边界时继续显示旧页，
 * 全程无反馈）。
 */
export function GridSkeleton({ count = 8 }: { count?: number }) {
    return (
        <div className="mx-auto max-w-5xl px-4 py-8" aria-busy="true">
            <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-surface" />
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: count }).map((_, i) => (
                    <div key={i} className="overflow-hidden rounded-xl border border-line bg-white">
                        <div className="aspect-square w-full animate-pulse bg-surface" />
                        <div className="p-3">
                            <div className="h-4 w-3/4 animate-pulse rounded bg-surface" />
                            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-surface" />
                            <div className="mt-3 h-4 w-16 animate-pulse rounded bg-surface" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
