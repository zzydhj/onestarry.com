import { PrefetchLink } from "@/components/PrefetchLink";
import { listRecentOrders } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { PERMISSIONS, formatMoney } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";

export const dynamic = "force-dynamic";

/** 后台订单列表（受保护）：最近订单，点进详情。 */
export default async function AdminOrders() {
    const { env } = await requirePermission(PERMISSIONS.orderWrite);
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const rows = await listRecentOrders(db, 200);

    return (
        <main className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-xl font-semibold">
                订单 <span className="ml-1 text-sm font-normal text-muted">（{rows.length}）</span>
            </h1>
            <TableFrame className="mt-6">
                <table className="w-full text-sm">
                    <THead>
                        <tr>
                            <Th>单号</Th>
                            <Th>邮箱</Th>
                            <Th>金额</Th>
                            <Th>支付</Th>
                            <Th>履约</Th>
                            <Th>时间</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {rows.map((o) => (
                            <Tr key={o.id} className="hover:bg-surface">
                                <Td className="font-mono text-xs">
                                    <PrefetchLink href={`/orders/${o.id}`} className="text-accent hover:underline">
                                        {o.orderNumber}
                                    </PrefetchLink>
                                </Td>
                                <Td>{o.email}</Td>
                                <Td>{formatMoney(o.totalCents, o.currency)}</Td>
                                <Td>{o.paymentStatus}</Td>
                                <Td>{o.fulfillmentStatus}</Td>
                                <Td className="text-xs text-muted">{o.createdAt?.toISOString?.().slice(0, 16).replace("T", " ")}</Td>
                            </Tr>
                        ))}
                    </tbody>
                </table>
            </TableFrame>
        </main>
    );
}
