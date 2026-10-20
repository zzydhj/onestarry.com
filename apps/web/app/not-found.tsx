import Link from "next/link";

/** 全站 404（品牌化）。找不到路由/调用 notFound() 时渲染。 */
export default function NotFound() {
    return (
        <main className="mx-auto flex max-w-5xl flex-col items-center px-4 py-24 text-center">
            <p className="text-sm font-medium uppercase tracking-widest text-muted">404</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-brand">Page not found</h1>
            <p className="mt-3 max-w-md text-sm text-muted">
                The page you&apos;re looking for doesn&apos;t exist or may have moved.
            </p>
            <div className="mt-6 flex gap-3">
                <Link href="/" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
                    Back home
                </Link>
                <Link href="/products" className="rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:border-accent">
                    All products
                </Link>
            </div>
        </main>
    );
}
