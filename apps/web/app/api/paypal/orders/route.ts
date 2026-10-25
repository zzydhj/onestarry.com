import { isPaypalOrderReusable } from "@onestarry/core";
import { setOrderPaypalOrderId } from "@onestarry/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { paypalCreateOrder, paypalShowOrder, paypalWriteBlocked, readPaypalConfig } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PayPal 按钮的 `createOrder` 回调：为**我方订单**建（或复用）一张 PayPal 单。
 *
 * 三条不可让的口径：
 *   1. 金额只取 `orders.total_cents`，**请求体里不给金额字段**（给了也不用）—— 否则前端改数就是白送钱；
 *   2. 凭证不过就 403（见 `lib/orderAccess`），游客没有凭证连这张单存在都不确认；
 *   3. 同一张我方单尽量**复用**已存在的 PayPal 单：`PayPal-Request-Id` 稳定 + 先查状态，
 *      否则用户狂点按钮会造出多张可扣款单，最后靠退款收场。
 */
const MAX_BODY_BYTES = 8 * 1024;

async function json(body: unknown, init?: ResponseInit): Promise<Response> {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
    });
}

export async function POST(req: Request): Promise<Response> {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });

    let body: { orderNumber?: unknown; token?: unknown };
    try {
        body = (await req.json()) as typeof body;
    } catch {
        return json({ error: "BAD_JSON" }, { status: 400 });
    }
    const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber : "";
    const token = typeof body.token === "string" ? body.token : null;

    const { env } = getCloudflareContext();
    const cfg = readPaypalConfig(env);
    if (!cfg) return json({ error: "PAYPAL_NOT_CONFIGURED" }, { status: 503 });
    // 沙箱凭据默认不许动生产账（要测就显式开 PAYPAL_ALLOW_SANDBOX）。在建单这一环就拦，
    // 而不是等扣款那一步才报错：别让买家走完一整个 PayPal 弹窗才发现不能付。
    const blocked = paypalWriteBlocked(cfg, env.PAYPAL_ALLOW_SANDBOX);
    if (blocked) return json({ error: blocked }, { status: 503 });

    const access = await resolveOrderAccess(orderNumber, token);
    if (!access.ok) return json({ error: access.reason }, { status: access.status });
    // 支付接口不给降级：没凭证就是 403（确认页那种“掩码看看”在这里没意义）。
    if (!access.canSeeFull) return json({ error: "NEED_TOKEN" }, { status: 403 });
    if (!access.payable) return json({ error: "NOT_PAYABLE" }, { status: 409 });

    const origin = new URL(req.url).origin;
    const returnUrl = `${origin}/order/${access.order.orderNumber}?t=${token ?? ""}`;
    const cancelUrl = `${origin}/pay/${access.order.orderNumber}?t=${token ?? ""}&canceled=1`;

    // 已有 PayPal 单：还活着就原样复用；已经扣款成功则拒绝再建（等回调/对账把状态追平）。
    const existing = access.order.paypalOrderId;
    if (existing) {
        const { status } = await paypalShowOrder(cfg, existing);
        if (isPaypalOrderReusable(status)) return json({ orderID: existing });
        if (status === "COMPLETED") return json({ error: "ALREADY_PAID_AT_PSP" }, { status: 409 });
    }

    // 键稳定 = 同一张我方单同一时刻只会有一张 PayPal 单；换过 PayPal 单后键自然跟着换。
    const paypalRequestId = `${access.order.orderNumber}:${existing ?? "1"}`;
    const created = await paypalCreateOrder(cfg, {
        orderNumber: access.order.orderNumber,
        amountCents: access.order.totalCents,
        currency: access.order.currency,
        description: `OneStarry order ${access.order.orderNumber}`,
        returnUrl,
        cancelUrl,
        paypalRequestId,
    });

    await setOrderPaypalOrderId(access.db, { orderId: access.order.id, paypalOrderId: created.paypalOrderId });
    return json({ orderID: created.paypalOrderId });
}
