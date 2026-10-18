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
        <div className="mx-auto max-w-lg px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">Order placed 🎉</h1>
            <p className="mt-2 text-muted">Order number: <strong className="text-fg">{order.orderNumber}</strong></p>
            <p className="mt-1 text-sm text-muted">Status: {order.status} · Payment: {order.paymentStatus} · {order.email}</p>

            <ul className="mt-6 divide-y divide-line">
                {items.map((it) => (
                    <li key={it.id} className="flex justify-between py-2 text-sm">
                        <span>{it.title ?? "Item"} × {it.quantity}</span>
                        <span>{money(it.unitPriceCents * it.quantity, order.currency)}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-2 space-y-1 text-right text-sm text-muted">
                {order.discountCents > 0 && <div>Discount -{money(order.discountCents, order.currency)}</div>}
                <div>Shipping {money(order.shippingCents, order.currency)}</div>
                {order.taxCents > 0 && <div>Tax {money(order.taxCents, order.currency)}</div>}
                {order.dutyCents > 0 && <div>Duty {money(order.dutyCents, order.currency)}</div>}
            </div>
            <div className="mt-2 flex justify-between text-lg font-bold text-brand">
                <span>Total</span>
                <span>{money(order.totalCents, order.currency)}</span>
            </div>

            <p className="mt-8">
                <Link href="/" className="text-sm text-muted transition hover:text-accent">← All products</Link>
            </p>
        </div>
    );
}
