import { PrefetchLink } from "@/components/PrefetchLink";
import { notFound } from "next/navigation";
import { getOrderDetail } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { PERMISSIONS, formatMoney } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";
import { ShipForm } from "./ShipForm";

export const dynamic = "force-dynamic";

/** 订单详情（受保护）：明细/行/地址/发货信息 + 已支付未发货时提供"标记发货"。 */
export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await requirePermission(PERMISSIONS.orderWrite);

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const detail = await getOrderDetail(db, id);
    if (!detail) notFound();
    const { order, items, lines, shipment } = detail;
    const cur = order.currency;
    const addr = (order.addressSnapshot ?? {}) as Record<string, string | undefined>;
    const canShip = order.paymentStatus === "paid" && order.fulfillmentStatus !== "fulfilled";

    return (
        <main className="mx-auto max-w-2xl px-4 py-8">
            <PrefetchLink href="/orders" className="text-sm text-muted transition hover:text-accent">← 返回订单列表</PrefetchLink>
            <h1 className="mt-2 font-mono text-xl font-semibold">{order.orderNumber}</h1>
            <p className="mt-1 text-sm text-muted">
                {order.email} · {order.createdAt?.toISOString?.().slice(0, 16).replace("T", " ")} · 支付 <strong className="text-fg">{order.paymentStatus}</strong> · 履约 <strong className="text-fg">{order.fulfillmentStatus}</strong>
            </p>

            <h2 className="mt-6 text-base font-semibold">明细</h2>
            <TableFrame className="mt-2">
                <table className="w-full text-sm">
                    <THead>
                        <tr>
                            <Th>SKU</Th>
                            <Th>数量</Th>
                            <Th>单价</Th>
                            <Th>小计</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {items.map((it) => (
                            <Tr key={it.id}>
                                <Td className="font-mono text-xs">{it.sku ?? "—"}</Td>
                                <Td>{it.quantity}</Td>
                                <Td>{formatMoney(it.unitPriceCents, cur)}</Td>
                                <Td>{formatMoney(it.unitPriceCents * it.quantity, cur)}</Td>
                            </Tr>
                        ))}
                    </tbody>
                </table>
            </TableFrame>

            <h2 className="mt-6 text-base font-semibold">金额</h2>
            <table className="mt-2 text-sm">
                <tbody>
                    <tr><td className="py-1 pr-8 text-muted">商品小计</td><td>{formatMoney(order.subtotalCents, cur)}</td></tr>
                    {order.discountCents > 0 && <tr><td className="py-1 pr-8 text-muted">折扣</td><td>-{formatMoney(order.discountCents, cur)}</td></tr>}
                    <tr><td className="py-1 pr-8 text-muted">运费</td><td>{formatMoney(order.shippingCents, cur)}</td></tr>
                    <tr><td className="py-1 pr-8 text-muted">税</td><td>{formatMoney(order.taxCents, cur)}</td></tr>
                    <tr><td className="py-1 pr-8 text-muted">关税</td><td>{formatMoney(order.dutyCents, cur)}</td></tr>
                    <tr className="font-semibold"><td className="py-1 pr-8">合计</td><td>{formatMoney(order.totalCents, cur)}</td></tr>
                </tbody>
            </table>
            {lines.length > 0 && (
                <p className="mt-1 text-xs text-muted">行项：{lines.map((l) => `${l.type}:${formatMoney(l.amountCents, cur)}`).join(" · ")}</p>
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
                <ShipForm orderId={order.id} />
            ) : (
                <p className="mt-2 text-sm text-muted">{order.paymentStatus !== "paid" ? "未支付，暂不可发货。" : "已发货。"}</p>
            )}
        </main>
    );
}
