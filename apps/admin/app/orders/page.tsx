import Link from "next/link";
import { createDb, listRecentOrders } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/** 后台订单列表（受保护）：最近订单，点进详情。 */
export default async function AdminOrders() {
    const { env } = await requireAdmin();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const rows = await listRecentOrders(db, 200);

    return (
        <main className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-xl font-semibold">
                订单 <span className="ml-1 text-sm font-normal text-muted">（{rows.length}）</span>
            </h1>
            <div className="mt-6 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                    <thead className="border-b border-line text-left text-muted">
                        <tr>
                            <th className="px-4 py-2 font-medium">单号</th>
                            <th className="px-4 py-2 font-medium">邮箱</th>
                            <th className="px-4 py-2 font-medium">金额</th>
                            <th className="px-4 py-2 font-medium">支付</th>
                            <th className="px-4 py-2 font-medium">履约</th>
                            <th className="px-4 py-2 font-medium">时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((o) => (
                            <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface">
                                <td className="px-4 py-2 font-mono text-xs">
                                    <Link href={`/orders/${o.id}`} className="text-accent hover:underline">
                                        {o.orderNumber}
                                    </Link>
                                </td>
                                <td className="px-4 py-2">{o.email}</td>
                                <td className="px-4 py-2">{money(o.totalCents, o.currency)}</td>
                                <td className="px-4 py-2">{o.paymentStatus}</td>
                                <td className="px-4 py-2">{o.fulfillmentStatus}</td>
                                <td className="px-4 py-2 text-xs text-muted">{o.createdAt?.toISOString?.().slice(0, 16).replace("T", " ")}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </main>
    );
}
