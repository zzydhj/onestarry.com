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
                    <Link href="/" className="transition hover:text-accent">
                        全部商品
                    </Link>
                    <Link href="/cart" className="transition hover:text-accent">
                        购物车
                    </Link>
                    <Link href="/account/orders" className="transition hover:text-accent">
                        我的订单
                    </Link>
                </nav>
            </div>
        </header>
    );
}
