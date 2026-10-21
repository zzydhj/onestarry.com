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
