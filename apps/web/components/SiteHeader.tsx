import Link from "next/link";

/** 全站顶部导航。 */
export function SiteHeader() {
    return (
        <header className="sticky top-0 z-10 border-b border-line bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <Link href="/" className="text-lg font-semibold tracking-tight text-brand">
                    onestarry
                </Link>
                <nav className="flex items-center gap-5 text-sm text-muted">
                    <Link href="/products" className="transition hover:text-accent">
                        Products
                    </Link>
                    <Link href="/categories" className="transition hover:text-accent">
                        Categories
                    </Link>
                    <Link href="/brands" className="transition hover:text-accent">
                        Brands
                    </Link>
                    <Link href="/cart" className="transition hover:text-accent">
                        Cart
                    </Link>
                    <Link href="/account/orders" className="transition hover:text-accent">
                        Orders
                    </Link>
                </nav>
                <form action="/search" method="get" className="hidden md:block">
                    <input
                        type="search"
                        name="q"
                        placeholder="Search…"
                        aria-label="Search products"
                        className="w-36 rounded-lg border border-line px-3 py-1.5 text-sm outline-none transition focus:border-accent"
                    />
                </form>
            </div>
        </header>
    );
}
