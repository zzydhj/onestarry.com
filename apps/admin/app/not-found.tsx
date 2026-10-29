/**
 * 后台 404（未匹配路由 / 页面主动 notFound()）。
 * 刻意不读会话：404 不该因为鉴权失败再抛一层错，也不给任何内部路径线索。
 * 返回入口用 <Link>（后台内跳转必须软导航，用 <a> 会整页刷新）。
 * 故意不用 PrefetchLink：那一枚组件会给 404 页拉一个客户端边界，而这一页刻意什么都不读
 * （不取会话、不给内部路径线索）；悬停预取对“从 404 回概览”不值这个代价。`prefetch={false}` 仍必须写：
 * 不写就是进视口真预取，而后台全是 force-dynamic（守卫见 core/admin-prefetch.test.ts）。
 */
import Link from "next/link";

export default function AdminNotFound() {
    return (
        <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
            <p className="text-sm font-medium text-muted">404</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-brand">找不到这个页面</h1>
            <p className="mt-3 max-w-md text-sm text-muted">地址可能已经变更，或你访问了一个不存在的记录。</p>
            <Link
                href="/"
                prefetch={false}
                className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
                回到概览
            </Link>
        </main>
    );
}
