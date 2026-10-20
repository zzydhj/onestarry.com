"use client";

/** 路由级错误边界：渲染在根布局内（有 Tailwind），提供重试。 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <main className="mx-auto flex max-w-5xl flex-col items-center px-4 py-24 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">Something went wrong</h1>
            <p className="mt-3 max-w-md text-sm text-muted">An unexpected error occurred. Please try again.</p>
            <button
                onClick={reset}
                className="mt-6 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
                Try again
            </button>
        </main>
    );
}
