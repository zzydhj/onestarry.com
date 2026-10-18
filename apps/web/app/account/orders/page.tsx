import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCustomerAuth } from "@onestarry/auth";
import { createDb, listOrdersByCustomer } from "@onestarry/db";

export const dynamic = "force-dynamic";

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
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/" style={{ color: "#666", fontSize: 14 }}>← 首页</Link></p>
            <h1 style={{ fontSize: 24 }}>我的订单</h1>
            <p style={{ fontSize: 13, color: "#666" }}>{session.user.email}</p>

            {rows.length === 0 ? (
                <p style={{ color: "#888" }}>还没有订单。</p>
            ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                            <th style={{ padding: "6px 8px" }}>单号</th>
                            <th style={{ padding: "6px 8px" }}>金额</th>
                            <th style={{ padding: "6px 8px" }}>支付</th>
                            <th style={{ padding: "6px 8px" }}>履约</th>
                            <th style={{ padding: "6px 8px" }}>时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((o) => (
                            <tr key={o.id} style={{ borderBottom: "1px solid #eee" }}>
                                <td style={{ padding: "6px 8px" }}>
                                    <Link href={`/order/${o.orderNumber}`} style={{ color: "#0366d6", textDecoration: "none", fontFamily: "monospace", fontSize: 12 }}>
                                        {o.orderNumber}
                                    </Link>
                                </td>
                                <td style={{ padding: "6px 8px" }}>{money(o.totalCents, o.currency)}</td>
                                <td style={{ padding: "6px 8px" }}>{o.paymentStatus}</td>
                                <td style={{ padding: "6px 8px" }}>{o.fulfillmentStatus}</td>
                                <td style={{ padding: "6px 8px", color: "#888", fontSize: 12 }}>{o.createdAt?.toISOString?.().slice(0, 16).replace("T", " ")}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </main>
    );
}
