import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getCartLines } from "@onestarry/db";
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
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/" style={{ color: "#666", fontSize: 14 }}>← 继续购物</Link></p>
            <h1 style={{ fontSize: 24 }}>购物车</h1>

            {lines.length === 0 ? (
                <p style={{ color: "#888" }}>购物车是空的。</p>
            ) : (
                <>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                                <th style={{ padding: "6px 8px" }}>商品</th>
                                <th style={{ padding: "6px 8px" }}>数量</th>
                                <th style={{ padding: "6px 8px" }}>小计</th>
                                <th style={{ padding: "6px 8px" }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((l) => {
                                const qty = cart[l.variantId] ?? 0;
                                return (
                                    <tr key={l.variantId} style={{ borderBottom: "1px solid #eee" }}>
                                        <td style={{ padding: "6px 8px" }}>
                                            {l.title}
                                            <div style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>{l.sku}</div>
                                            {l.blocked || l.available < qty ? (
                                                <div style={{ fontSize: 11, color: "#b00000" }}>
                                                    {l.blocked ? "当前不可售" : `库存仅 ${l.available}`}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td style={{ padding: "6px 8px" }}>
                                            <form action={setQtyAction} style={{ display: "flex", gap: 4 }}>
                                                <input type="hidden" name="variantId" value={l.variantId} />
                                                <input name="qty" type="number" min={0} defaultValue={qty} style={{ width: 64 }} />
                                                <button type="submit">改</button>
                                            </form>
                                        </td>
                                        <td style={{ padding: "6px 8px" }}>{money(l.unitCents * qty, l.currency)}</td>
                                        <td style={{ padding: "6px 8px" }}>
                                            <form action={removeItemAction}>
                                                <input type="hidden" name="variantId" value={l.variantId} />
                                                <button type="submit">✕</button>
                                            </form>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    <div style={{ marginTop: 16, textAlign: "right", fontSize: 14 }}>
                        <div>小计 {money(subtotal, currency)}</div>
                        <div>运费 {money(SHIPPING_CENTS, currency)}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>合计 {money(total, currency)}</div>
                    </div>
                    <div style={{ marginTop: 16, textAlign: "right" }}>
                        <Link
                            href="/checkout"
                            style={{ display: "inline-block", padding: "10px 18px", background: "#111", color: "#fff", borderRadius: 6, textDecoration: "none" }}
                        >
                            去结账 →
                        </Link>
                    </div>
                </>
            )}
        </main>
    );
}
