import Link from "next/link";
import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getCartLines } from "@onestarry/db";
import { buttonVariants } from "@onestarry/ui";
import { readCart } from "@/lib/cart";
import { CartLines } from "./CartLines";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cart", robots: { index: false, follow: false } };

const SHIPPING_CENTS = 500; // MVP 占位运费（真实 computeShipping 待接）

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 购物车页：读 cookie → 按 DB 重新取价/库存（一条查询）→ 行编辑交给乐观组件 → 去结账。 */
export default async function CartPage() {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cart = await readCart();
    const ids = Object.keys(cart);
    const lines = await getCartLines(db, ids, "us", "en");

    let subtotal = 0;
    for (const l of lines) subtotal += l.unitCents * (cart[l.variantId] ?? 0);
    const currency = lines[0]?.currency ?? "USD";
    const total = subtotal + (lines.length ? SHIPPING_CENTS : 0);

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/" className="text-sm text-muted transition hover:text-accent">← Continue shopping</Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Cart</h1>

            {lines.length === 0 ? (
                <p className="mt-6 text-muted">Your cart is empty.</p>
            ) : (
                <>
                    <CartLines lines={lines} qty={cart} shippingCents={SHIPPING_CENTS} />
                    <div className="mt-6 text-right">
                        <Link href="/checkout" className={buttonVariants()}>
                            Checkout →
                        </Link>
                    </div>
                    <p className="mt-2 text-right text-xs text-muted">
                        {money(total, currency)} due at checkout
                    </p>
                </>
            )}
        </div>
    );
}
