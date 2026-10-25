"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@onestarry/core";
import { recordShipment } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

/**
 * 标记发货：recordShipment（确认收入/COGS + 扣库存 + 转 fulfilled + 发 order.shipped）。需 order:write。
 * 返回 ok 给乐观 UI 用：后台页面会先把区块显示成“已发货”，失败时必须能回滚，
 * 否则运营会以为货已发（比“慢”严重得多）。旧写法是吞掉异常让页面静默回到真状态。
 */
export async function markShippedAction(formData: FormData): Promise<{ ok: boolean }> {
    const { env } = await requirePermission(PERMISSIONS.orderWrite);

    const orderId = String(formData.get("orderId") ?? "");
    if (!orderId) return { ok: false };
    const carrier = String(formData.get("carrier") ?? "").trim() || undefined;
    const trackingNumber = String(formData.get("trackingNumber") ?? "").trim() || undefined;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    try {
        await db.transaction(async (tx) => {
            await recordShipment(tx, { orderId, carrier, trackingNumber });
        });
    } catch {
        // 未支付 / 已发货 / 账本不平 等：不刷新也不报错，由调用方回滚乐观态
        return { ok: false };
    }
    revalidatePath(`/orders/${orderId}`);
    return { ok: true };
}
