import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getOrderByNumber } from "@onestarry/db";

export const dynamic = "force-dynamic";

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
    const { orderNumber } = await params;
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);

    const res = await getOrderByNumber(db, decodeURIComponent(orderNumber));
    if (!res) notFound();
    const { order, items } = res;

    return (
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <h1 style={{ fontSize: 24 }}>下单成功 🎉</h1>
            <p style={{ color: "#555" }}>
                订单号：<strong>{order.orderNumber}</strong>
            </p>
            <p style={{ color: "#555", fontSize: 14 }}>
                状态：{order.status} · 支付 {order.paymentStatus} · 邮箱 {order.email}
            </p>

            <ul style={{ listStyle: "none", padding: 0, borderTop: "1px solid #eee", marginTop: 16 }}>
                {items.map((it) => (
                    <li key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f4f4f4" }}>
                        <span>{it.title ?? "商品"} × {it.quantity}</span>
                        <span>{money(it.unitPriceCents * it.quantity, order.currency)}</span>
                    </li>
                ))}
            </ul>
            <div style={{ marginTop: 12, fontSize: 14, textAlign: "right", color: "#555" }}>
                {order.discountCents > 0 && <div>折扣 -{money(order.discountCents, order.currency)}</div>}
                <div>运费 {money(order.shippingCents, order.currency)}</div>
                {order.taxCents > 0 && <div>税 {money(order.taxCents, order.currency)}</div>}
                {order.dutyCents > 0 && <div>关税 {money(order.dutyCents, order.currency)}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18, marginTop: 8 }}>
                <span>合计</span>
                <span>{money(order.totalCents, order.currency)}</span>
            </div>

            <p style={{ marginTop: 24 }}>
                <Link href="/" style={{ color: "#666" }}>← 全部商品</Link>
            </p>
        </main>
    );
}
