import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getCartLines } from "@onestarry/db";
import { Button, Input, buttonVariants } from "@onestarry/ui";
import { readCart } from "@/lib/cart";
import { removeItemAction, setQtyAction } from "./actions";

export const dynamic = "force-dynamic";

const SHIPPING_CENTS = 500; // MVP 占位运费（真实 computeShipping 待接）

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 购物车页：读 cookie → 按 DB 重新取价/库存 → 行编辑 → 去结账。 */
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
                    <ul className="mt-6 divide-y divide-line">
                        {lines.map((l) => {
                            const qty = cart[l.variantId] ?? 0;
                            return (
                                <li key={l.variantId} className="flex items-center justify-between gap-4 py-4">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{l.title}</div>
                                        <div className="font-mono text-xs text-muted">{l.sku}</div>
                                        {l.blocked || l.available < qty ? (
                                            <div className="text-xs text-red-600">{l.blocked ? "Not available" : `Only ${l.available} left`}</div>
                                        ) : null}
                                    </div>
                                    <form action={setQtyAction} className="flex items-center gap-2">
                                        <input type="hidden" name="variantId" value={l.variantId} />
                                        <Input name="qty" type="number" min={0} defaultValue={qty} className="w-16 px-2 py-1" />
                                        <Button type="submit" variant="secondary" size="sm">Update</Button>
                                    </form>
                                    <div className="w-24 text-right font-medium">{money(l.unitCents * qty, l.currency)}</div>
                                    <form action={removeItemAction}>
                                        <input type="hidden" name="variantId" value={l.variantId} />
                                        <button type="submit" className="text-muted transition hover:text-red-600">✕</button>
                                    </form>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="mt-6 space-y-1 text-right text-sm">
                        <div>Subtotal {money(subtotal, currency)}</div>
                        <div>Shipping {money(SHIPPING_CENTS, currency)}</div>
                        <div className="pt-1 text-lg font-bold text-brand">Total {money(total, currency)}</div>
                    </div>
                    <div className="mt-6 text-right">
                        <Link href="/checkout" className={buttonVariants()}>
                            Checkout →
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
}
