"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createDb, recordShipment } from "@onestarry/db";

/** 标记发货：recordShipment（确认收入/COGS + 扣库存 + 转 fulfilled + 发 order.shipped）。 */
export async function markShippedAction(formData: FormData): Promise<void> {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");

    const orderId = String(formData.get("orderId") ?? "");
    if (!orderId) return;
    const carrier = String(formData.get("carrier") ?? "").trim() || undefined;
    const trackingNumber = String(formData.get("trackingNumber") ?? "").trim() || undefined;

    const db = createDb(env.HYPERDRIVE.connectionString);
    try {
        await db.transaction(async (tx) => {
            await recordShipment(tx, { orderId, carrier, trackingNumber });
        });
    } catch {
        // 未支付 / 已发货 / 账本不平 等：忽略，刷新后页面反映真实状态
    }
    revalidatePath(`/orders/${orderId}`);
}
