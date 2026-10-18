import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getCartLines } from "@onestarry/db";
import { readCart } from "@/lib/cart";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

const SHIPPING_CENTS = 500;

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 结账页：订单摘要 + 收货地址表单 → checkoutAction 建单。 */
export default async function Checkout({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cart = await readCart();
    const lines = await getCartLines(db, Object.keys(cart), "us", "en");
    const { error } = await searchParams;

    if (lines.length === 0) {
        return (
            <div className="mx-auto max-w-lg px-4 py-8">
                <Link href="/cart" className="text-sm text-muted transition hover:text-accent">← Back to cart</Link>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Checkout</h1>
                <p className="mt-6 text-muted">Your cart is empty. <Link href="/cart" className="text-accent hover:underline">Add items</Link> first.</p>
            </div>
        );
    }

    let subtotal = 0;
    for (const l of lines) subtotal += l.unitCents * (cart[l.variantId] ?? 0);
    const currency = lines[0]?.currency ?? "USD";
    const total = subtotal + SHIPPING_CENTS;

    return (
        <div className="mx-auto max-w-lg px-4 py-8">
            <Link href="/cart" className="text-sm text-muted transition hover:text-accent">← Back to cart</Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Checkout</h1>
            {error === "invalid" && <p className="mt-3 text-sm text-red-600">Please fill in email, recipient and address.</p>}
            {error === "failed" && <p className="mt-3 text-sm text-red-600">Order failed: some items may be unavailable or out of stock.</p>}

            <h2 className="mt-6 text-base font-semibold">Order</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
                {lines.map((l) => {
                    const qty = cart[l.variantId] ?? 0;
                    return (
                        <li key={l.variantId} className="flex justify-between py-2">
                            <span>{l.title} × {qty}</span>
                            <span>{money(l.unitCents * qty, l.currency)}</span>
                        </li>
                    );
                })}
            </ul>
            <div className="mt-2 space-y-1 text-right text-sm">
                <div>Subtotal {money(subtotal, currency)}</div>
                <div>Shipping {money(SHIPPING_CENTS, currency)}</div>
                <div className="text-lg font-bold text-brand">Total {money(total, currency)}</div>
            </div>

            <form action={checkoutAction} className="mt-6">
                <label className="mt-3 block text-sm text-muted">Email *</label>
                <input name="email" type="email" required placeholder="you@example.com" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                <label className="mt-3 block text-sm text-muted">Recipient *</label>
                <input name="recipient" required className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                <label className="mt-3 block text-sm text-muted">Phone</label>
                <input name="phone" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                <label className="mt-3 block text-sm text-muted">Address *</label>
                <input name="line1" required className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                <label className="mt-3 block text-sm text-muted">Apartment, suite, etc.</label>
                <input name="line2" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                        <label className="block text-sm text-muted">City</label>
                        <input name="city" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                    </div>
                    <div>
                        <label className="block text-sm text-muted">State</label>
                        <input name="region" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                    </div>
                    <div>
                        <label className="block text-sm text-muted">ZIP</label>
                        <input name="postalCode" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                    </div>
                </div>
                <label className="mt-3 block text-sm text-muted">Country</label>
                <input name="country" defaultValue="US" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-fg" />
                <button type="submit" className="mt-6 w-full rounded-lg bg-accent px-5 py-2.5 font-medium text-white transition hover:opacity-90">Place order</button>
            </form>
            <p className="mt-3 text-xs text-muted">Note: MVP demo — payment is a placeholder (order is created without a real PSP).</p>
        </div>
    );
}
