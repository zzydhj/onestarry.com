import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, getOrderDetail } from "@onestarry/db";
import { markShippedAction } from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 订单详情（受保护）：明细/行/地址/发货信息 + 已支付未发货时提供"标记发货"。 */
export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const db = createDb(env.HYPERDRIVE.connectionString);
    const detail = await getOrderDetail(db, id);
    if (!detail) notFound();
    const { order, items, lines, shipment } = detail;
    const cur = order.currency;
    const addr = (order.addressSnapshot ?? {}) as Record<string, string | undefined>;
    const canShip = order.paymentStatus === "paid" && order.fulfillmentStatus !== "fulfilled";

    return (
        <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/orders">← 返回订单列表</Link></p>
            <h1 style={{ fontSize: 22 }}>{order.orderNumber}</h1>
            <p style={{ fontSize: 13, color: "#666" }}>
                {order.email} · {order.createdAt?.toISOString?.().slice(0, 16).replace("T", " ")} ·
                支付 <strong>{order.paymentStatus}</strong> · 履约 <strong>{order.fulfillmentStatus}</strong>
            </p>

            <h2 style={{ fontSize: 16, marginTop: 20 }}>明细</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                        <th style={{ padding: "4px 8px" }}>SKU</th>
                        <th style={{ padding: "4px 8px" }}>数量</th>
                        <th style={{ padding: "4px 8px" }}>单价</th>
                        <th style={{ padding: "4px 8px" }}>小计</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((it) => (
                        <tr key={it.id} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 12 }}>{it.sku ?? "—"}</td>
                            <td style={{ padding: "4px 8px" }}>{it.quantity}</td>
                            <td style={{ padding: "4px 8px" }}>{money(it.unitPriceCents, cur)}</td>
                            <td style={{ padding: "4px 8px" }}>{money(it.unitPriceCents * it.quantity, cur)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h2 style={{ fontSize: 16, marginTop: 20 }}>金额</h2>
            <table style={{ fontSize: 14, borderCollapse: "collapse" }}>
                <tbody>
                    <tr><td style={{ padding: "2px 12px 2px 0", color: "#666" }}>商品小计</td><td>{money(order.subtotalCents, cur)}</td></tr>
                    {order.discountCents > 0 && <tr><td style={{ padding: "2px 12px 2px 0", color: "#666" }}>折扣</td><td>-{money(order.discountCents, cur)}</td></tr>}
                    <tr><td style={{ padding: "2px 12px 2px 0", color: "#666" }}>运费</td><td>{money(order.shippingCents, cur)}</td></tr>
                    <tr><td style={{ padding: "2px 12px 2px 0", color: "#666" }}>税</td><td>{money(order.taxCents, cur)}</td></tr>
                    <tr><td style={{ padding: "2px 12px 2px 0", color: "#666" }}>关税</td><td>{money(order.dutyCents, cur)}</td></tr>
                    <tr style={{ fontWeight: 700 }}><td style={{ padding: "2px 12px 2px 0" }}>合计</td><td>{money(order.totalCents, cur)}</td></tr>
                </tbody>
            </table>
            {lines.length > 0 && (
                <p style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
                    行项：{lines.map((l) => `${l.type}:${money(l.amountCents, cur)}`).join(" · ")}
                </p>
            )}

            <h2 style={{ fontSize: 16, marginTop: 20 }}>收货地址</h2>
            <p style={{ fontSize: 14, color: "#444", lineHeight: 1.6 }}>
                {addr.recipient} {addr.phone && `· ${addr.phone}`}<br />
                {addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />
                {addr.city} {addr.region} {addr.postalCode} {addr.country}
            </p>

            <h2 style={{ fontSize: 16, marginTop: 20 }}>发货</h2>
            {shipment ? (
                <p style={{ fontSize: 14 }}>
                    状态 <strong>{shipment.status}</strong> · 承运商 {shipment.carrier ?? "—"} · 运单号{" "}
                    <code>{shipment.trackingNumber ?? "—"}</code>
                    {shipment.shippedAt ? ` · ${new Date(shipment.shippedAt).toISOString().slice(0, 16).replace("T", " ")}` : ""}
                </p>
            ) : canShip ? (
                <form action={markShippedAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <input name="carrier" placeholder="承运商（如 顺丰/4PX）" style={{ padding: 6 }} />
                    <input name="trackingNumber" placeholder="运单号" style={{ padding: 6 }} />
                    <button type="submit">标记发货</button>
                </form>
            ) : (
                <p style={{ fontSize: 14, color: "#888" }}>
                    {order.paymentStatus !== "paid" ? "未支付，暂不可发货。" : "已发货。"}
                </p>
            )}
        </main>
    );
}
