import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";
import { createDb, listOrdersByCustomer } from "@onestarry/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My Orders", robots: { index: false, follow: false } };

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 我的订单（前台，需客户登录）：按 customerId 列订单，点进确认页。 */
export default async function AccountOrders() {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createCustomerAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const db = createDb(env.HYPERDRIVE.connectionString);
    const rows = await listOrdersByCustomer(db, session.user.id);

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/" className="text-sm text-muted transition hover:text-accent">← Home</Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">My orders</h1>
            <p className="mt-1 text-sm text-muted">{session.user.email}</p>

            {rows.length === 0 ? (
                <p className="mt-6 text-muted">No orders yet.</p>
            ) : (
                <table className="mt-6 w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-muted">
                            <th className="py-2 pr-2 font-medium">Order</th>
                            <th className="py-2 pr-2 font-medium">Amount</th>
                            <th className="py-2 pr-2 font-medium">Payment</th>
                            <th className="py-2 pr-2 font-medium">Fulfillment</th>
                            <th className="py-2 font-medium">Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((o) => (
                            <tr key={o.id} className="border-b border-line">
                                <td className="py-2 pr-2">
                                    <Link href={`/order/${o.orderNumber}`} className="font-mono text-xs text-accent hover:underline">{o.orderNumber}</Link>
                                </td>
                                <td className="py-2 pr-2">{money(o.totalCents, o.currency)}</td>
                                <td className="py-2 pr-2">{o.paymentStatus}</td>
                                <td className="py-2 pr-2">{o.fulfillmentStatus}</td>
                                <td className="py-2 text-muted">{o.createdAt?.toISOString?.().slice(0, 10)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
