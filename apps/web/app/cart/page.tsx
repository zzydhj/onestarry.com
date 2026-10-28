import Link from "next/link";
import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getCartLines } from "@onestarry/db";
import { PLACEHOLDER_SHIPPING_CENTS } from "@onestarry/core";
import { buttonVariants } from "@onestarry/ui";
import { readCart } from "@/lib/cart";
import { CartLines } from "./CartLines";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cart", robots: { index: false, follow: false } };

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
    const total = subtotal + (lines.length ? PLACEHOLDER_SHIPPING_CENTS : 0);
    // 审查 M-7：下架/被禁售的行不静默丢（那会造成“输入 1000 整行消失”同类的静默问题），而是标红并拦住结账，
    // 让用户用行旁的 ✕ 移除；否则一路点到结账才被 createOrder 统一拒成笼统错误。
    const hasUnavailable = lines.some((l) => l.blocked || l.productStatus !== "active");

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/" className="text-sm text-muted transition hover:text-accent">← Continue shopping</Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Cart</h1>

            {lines.length === 0 ? (
                <p className="mt-6 text-muted">Your cart is empty.</p>
            ) : (
                <>
                    <CartLines lines={lines} qty={cart} shippingCents={PLACEHOLDER_SHIPPING_CENTS} />
                    {hasUnavailable ? (
                        <p className="mt-6 text-right text-sm text-red-600">
                            Some items are no longer available — remove them (✕) to continue.
                        </p>
                    ) : (
                        <div className="mt-6 text-right">
                            <Link href="/checkout" className={buttonVariants()}>
                                Checkout →
                            </Link>
                        </div>
                    )}
                    <p className="mt-2 text-right text-xs text-muted">
                        {money(total, currency)} due at checkout
                    </p>
                </>
            )}
        </div>
    );
}
