import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isOrderAccessToken, isOrderNumberShape } from "@onestarry/core";
import { createDb, getOrderByNumber } from "@onestarry/db";
import { readCustomerSession } from "./session";

/**
 * 「谁能看这张单 / 谁能替这张单付钱」的唯一判定口。
 *
 * 结账链路把一次性凭证 `public_token` 交给下单者（22 位 base64url ≈ 128 bit），登录客户还可以用会话；
 * 两条路任一命中即视为本人。之所以必须集中在一处：确认页、支付页、create 路由、capture 路由
 * 问的是同一个问题，四处各写一遍迟早会写成四种答案（上一轮 P0-1 就是这么来的）。
 */
export type OrderRow = NonNullable<Awaited<ReturnType<typeof getOrderByNumber>>>["order"];
export type OrderItemRow = NonNullable<Awaited<ReturnType<typeof getOrderByNumber>>>["items"];
export type Db = ReturnType<typeof createDb>;

export type OrderAccess =
    | {
        ok: true;
        db: Db;
        order: OrderRow;
        items: OrderItemRow;
        /** 会话归属或凭证命中 → 可看全部（邮箱明文）与发起支付。 */
        canSeeFull: boolean;
        payable: boolean;
    }
    | { ok: false; status: 400 | 404; reason: string };

/**
 * 注意：这里**只回答“这是谁的单”，不替调用方决定拒绝方式**。
 * 确认页允许无凭证时降级看（邮箱掩码），支付页与两个 API 路由则把 `canSeeFull=false` 当 403 ——
 * 同一个判定，不同的后果，但只有一份代码。
 */
export async function resolveOrderAccess(orderNumber: string, token: string | null | undefined): Promise<OrderAccess> {
    if (!isOrderNumberShape(orderNumber)) return { ok: false, status: 400, reason: "BAD_ORDER_NUMBER" };

    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const res = await getOrderByNumber(db, orderNumber);
    if (!res) return { ok: false, status: 404, reason: "NOT_FOUND" };

    const session = await readCustomerSession();
    const isOwner = !!session?.userId && res.order.customerId === session.userId;
    // 会话命中但归属是别人的单 → 连存在都不确认（与确认页同口径，不给枚举者反馈）。
    if (session?.userId && res.order.customerId && !isOwner) return { ok: false, status: 404, reason: "NOT_FOUND" };

    const tokenOk = !!token && isOrderAccessToken(token) && token === res.order.publicToken;
    const canSeeFull = isOwner || tokenOk;

    // 已付或已取消的单不许再发起扣款：钱只该被收一次，重复扣款要靠人工退款擦屁股。
    const payable = res.order.paymentStatus !== "paid" && res.order.status !== "cancelled";
    return { ok: true, db, order: res.order, items: res.items, canSeeFull, payable };
}
