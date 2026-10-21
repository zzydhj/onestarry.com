"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@onestarry/core";
import { createDb, recordShipment } from "@onestarry/db";
import { requirePermission } from "@/lib/auth";

/** 标记发货：recordShipment（确认收入/COGS + 扣库存 + 转 fulfilled + 发 order.shipped）。需 order:write。 */
export async function markShippedAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.orderWrite);

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
