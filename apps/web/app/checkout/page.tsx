import type { CSSProperties } from "react";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getCartLines } from "@onestarry/db";
import { readCart } from "@/lib/cart";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

const SHIPPING_CENTS = 500;
const field: CSSProperties = { padding: 8, width: "100%", boxSizing: "border-box" };
const label: CSSProperties = { fontSize: 13, color: "#555", display: "block", margin: "8px 0 4px" };

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
            <main style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
                <p><Link href="/cart" style={{ color: "#666", fontSize: 14 }}>← 返回购物车</Link></p>
                <h1 style={{ fontSize: 24 }}>结账</h1>
                <p style={{ color: "#888" }}>购物车是空的，先去 <Link href="/cart" style={{ color: "#0366d6" }}>加购</Link>。</p>
            </main>
        );
    }

    let subtotal = 0;
    for (const l of lines) subtotal += l.unitCents * (cart[l.variantId] ?? 0);
    const currency = lines[0]?.currency ?? "USD";
    const total = subtotal + SHIPPING_CENTS;

    return (
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/cart" style={{ color: "#666", fontSize: 14 }}>← 返回购物车</Link></p>
            <h1 style={{ fontSize: 24 }}>结账</h1>
            {error === "invalid" && <p style={{ color: "#b00000" }}>请填写邮箱、收件人和地址。</p>}
            {error === "failed" && <p style={{ color: "#b00000" }}>下单失败：部分商品可能不可售或库存不足。</p>}

            <h2 style={{ fontSize: 16, marginTop: 8 }}>订单</h2>
            <ul style={{ listStyle: "none", padding: 0, fontSize: 14 }}>
                {lines.map((l) => {
                    const qty = cart[l.variantId] ?? 0;
                    return (
                        <li key={l.variantId} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                            <span>{l.title} × {qty}</span>
                            <span>{money(l.unitCents * qty, l.currency)}</span>
                        </li>
                    );
                })}
            </ul>
            <div style={{ fontSize: 14, marginTop: 8, textAlign: "right" }}>
                <div>小计 {money(subtotal, currency)}</div>
                <div>运费 {money(SHIPPING_CENTS, currency)}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>合计 {money(total, currency)}</div>
            </div>

            <form action={checkoutAction} style={{ marginTop: 20 }}>
                <label style={label}>邮箱 *</label>
                <input name="email" type="email" required style={field} placeholder="you@example.com" />
                <label style={label}>收件人 *</label>
                <input name="recipient" required style={field} />
                <label style={label}>电话</label>
                <input name="phone" style={field} />
                <label style={label}>地址行1 *</label>
                <input name="line1" required style={field} />
                <label style={label}>地址行2</label>
                <input name="line2" style={field} />
                <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                        <label style={label}>城市</label>
                        <input name="city" style={field} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={label}>州/省</label>
                        <input name="region" style={field} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={label}>邮编</label>
                        <input name="postalCode" style={field} />
                    </div>
                </div>
                <label style={label}>国家</label>
                <input name="country" defaultValue="US" style={field} />
                <button type="submit" style={{ marginTop: 16, padding: "10px 18px", cursor: "pointer" }}>提交订单</button>
            </form>
            <p style={{ fontSize: 12, color: "#999", marginTop: 12 }}>注：MVP 演示，支付为占位（下单即建单，未接真实 PSP）。</p>
        </main>
    );
}
