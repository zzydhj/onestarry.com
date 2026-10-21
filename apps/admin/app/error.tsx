"use client";

import Link from "next/link";

/**
 * 后台路由级错误边界（渲染在根布局内，有 Tailwind）。
 * 与前台的关键差别：**这里要显示 digest** —— 它是 Cloudflare 日志里定位那次请求的唯一线索，
 * 后台是内部工具，暴露 digest 不构成信息泄露，反而省掉一整轮"你刚才报错是什么样"的来回。
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">这一页出错了</h1>
            <p className="mt-3 max-w-md text-sm text-muted">
                操作没有完成，数据不会被半写入（写动作都在事务里）。可以重试，或回概览换个入口进来。
            </p>
            {error.digest && (
                <p className="mt-4 rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-xs text-muted">
                    错误编号 {error.digest}
                </p>
            )}
            <div className="mt-6 flex gap-3">
                <button
                    onClick={reset}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                >
                    重试
                </button>
                <Link
                    href="/"
                    prefetch={false}
                    className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-brand transition hover:bg-surface"
                >
                    回概览
                </Link>
            </div>
        </main>
    );
}
