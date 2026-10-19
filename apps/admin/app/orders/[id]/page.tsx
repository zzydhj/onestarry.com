import Link from "next/link";
import { notFound } from "next/navigation";
import { createDb, getOrderDetail } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { markShippedAction } from "./actions";

export const dynamic = "force-dynamic";

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 订单详情（受保护）：明细/行/地址/发货信息 + 已支付未发货时提供"标记发货"。 */
export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await requireAdmin();

    const db = createDb(env.HYPERDRIVE.connectionString);
    const detail = await getOrderDetail(db, id);
    if (!detail) notFound();
    const { order, items, lines, shipment } = detail;
    const cur = order.currency;
    const addr = (order.addressSnapshot ?? {}) as Record<string, string | undefined>;
    const canShip = order.paymentStatus === "paid" && order.fulfillmentStatus !== "fulfilled";

    return (
        <main className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/orders" className="text-sm text-muted transition hover:text-accent">← 返回订单列表</Link>
            <h1 className="mt-2 font-mono text-xl font-semibold">{order.orderNumber}</h1>
            <p className="mt-1 text-sm text-muted">
                {order.email} · {order.createdAt?.toISOString?.().slice(0, 16).replace("T", " ")} · 支付 <strong className="text-fg">{order.paymentStatus}</strong> · 履约 <strong className="text-fg">{order.fulfillmentStatus}</strong>
            </p>

            <h2 className="mt-6 text-base font-semibold">明细</h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                    <thead className="border-b border-line text-left text-muted">
                        <tr>
                            <th className="px-4 py-2 font-medium">SKU</th>
                            <th className="px-4 py-2 font-medium">数量</th>
                            <th className="px-4 py-2 font-medium">单价</th>
                            <th className="px-4 py-2 font-medium">小计</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((it) => (
                            <tr key={it.id} className="border-b border-line last:border-0">
                                <td className="px-4 py-2 font-mono text-xs">{it.sku ?? "—"}</td>
                                <td className="px-4 py-2">{it.quantity}</td>
                                <td className="px-4 py-2">{money(it.unitPriceCents, cur)}</td>
                                <td className="px-4 py-2">{money(it.unitPriceCents * it.quantity, cur)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <h2 className="mt-6 text-base font-semibold">金额</h2>
            <table className="mt-2 text-sm">
                <tbody>
                    <tr><td className="py-1 pr-8 text-muted">商品小计</td><td>{money(order.subtotalCents, cur)}</td></tr>
                    {order.discountCents > 0 && <tr><td className="py-1 pr-8 text-muted">折扣</td><td>-{money(order.discountCents, cur)}</td></tr>}
                    <tr><td className="py-1 pr-8 text-muted">运费</td><td>{money(order.shippingCents, cur)}</td></tr>
                    <tr><td className="py-1 pr-8 text-muted">税</td><td>{money(order.taxCents, cur)}</td></tr>
                    <tr><td className="py-1 pr-8 text-muted">关税</td><td>{money(order.dutyCents, cur)}</td></tr>
                    <tr className="font-semibold"><td className="py-1 pr-8">合计</td><td>{money(order.totalCents, cur)}</td></tr>
                </tbody>
            </table>
            {lines.length > 0 && (
                <p className="mt-1 text-xs text-muted">行项：{lines.map((l) => `${l.type}:${money(l.amountCents, cur)}`).join(" · ")}</p>
            )}

            <h2 className="mt-6 text-base font-semibold">收货地址</h2>
            <p className="mt-2 text-sm leading-relaxed">
                {addr.recipient} {addr.phone && `· ${addr.phone}`}<br />
                {addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}<br />
                {addr.city} {addr.region} {addr.postalCode} {addr.country}
            </p>

            <h2 className="mt-6 text-base font-semibold">发货</h2>
            {shipment ? (
                <p className="mt-2 text-sm">
                    状态 <strong>{shipment.status}</strong> · 承运商 {shipment.carrier ?? "—"} · 运单号 <code className="font-mono text-xs">{shipment.trackingNumber ?? "—"}</code>
                    {shipment.shippedAt ? ` · ${new Date(shipment.shippedAt).toISOString().slice(0, 16).replace("T", " ")}` : ""}
                </p>
            ) : canShip ? (
                <form action={markShippedAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input name="carrier" placeholder="承运商（如 顺丰/4PX）" className="rounded-md border border-line px-3 py-1.5 text-sm" />
                    <input name="trackingNumber" placeholder="运单号" className="rounded-md border border-line px-3 py-1.5 text-sm" />
                    <button type="submit" className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90">标记发货</button>
                </form>
            ) : (
                <p className="mt-2 text-sm text-muted">{order.paymentStatus !== "paid" ? "未支付，暂不可发货。" : "已发货。"}</p>
            )}
        </main>
    );
}
