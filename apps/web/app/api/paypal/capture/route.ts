import { getCloudflareContext } from "@opennextjs/cloudflare";
import { recordPaymentSucceeded, setOrderPaypalOrderId } from "@onestarry/db";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { paypalCaptureOrder, paypalWriteBlocked, readPaypalConfig } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PayPal 按钮的 `onApprove` 回调：**由服务端扣款**并把订单落成已付。
 *
 * 为什么不能信前端递来的 `orderID`：那是浏览器给的字符串，不核对就等于任何人都能
 * 把「别人已经批准的一张 PayPal 单」递进来让我们入账 —— 钱是别人付的，货会按这个订单发。
 * 所以这里三道闸：
 *   ① 递来的 PayPal 单必须等于我们为该订单存过的那张；
 *   ② capture 响应里的 `custom_id` 必须等于我方单号（PSP 侧被改过就断）；
 *   ③ 金额必须等于订单应付（不等就 409，绝不按 PayPal 的数字改我们的账）。
 * 落账本身再兜一道：`recordPaymentSucceeded` 里同单重复落账会抛 `PAYMENT_ALREADY_RECORDED`，
 * 与 webhook 撞车时谁先到谁算，第二个当幂等重放处理。
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

    let body: { orderNumber?: unknown; token?: unknown; orderID?: unknown };
    try {
        body = (await req.json()) as typeof body;
    } catch {
        return json({ error: "BAD_JSON" }, { status: 400 });
    }
    const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber : "";
    const token = typeof body.token === "string" ? body.token : null;
    const paypalOrderID = typeof body.orderID === "string" ? body.orderID : "";

    const { env } = getCloudflareContext();
    const cfg = readPaypalConfig(env);
    if (!cfg) return json({ error: "PAYPAL_NOT_CONFIGURED" }, { status: 503 });
    // 同一个沙箱闸，而且必须卡在**真扣款之前**：过了一步就是把钱拿走了却没入账。
    // 方向是安全的：宁可拒接一笔能成功的扣款，也不接一笔“沙箱假钱标真单已付”。
    const blocked = paypalWriteBlocked(cfg, env.PAYPAL_ALLOW_SANDBOX);
    if (blocked) return json({ error: blocked }, { status: 503 });

    const access = await resolveOrderAccess(orderNumber, token);
    if (!access.ok) return json({ error: access.reason }, { status: access.status });
    if (!access.canSeeFull) return json({ error: "NEED_TOKEN" }, { status: 403 });
    const { db, order } = access;

    // 已经付过：不再扣第二次，直接把成功回给前端（按钮会跳确认页）。
    if (order.paymentStatus === "paid") return json({ status: "COMPLETED", alreadyRecorded: true });
    if (!access.payable) return json({ error: "NOT_PAYABLE" }, { status: 409 });

    // ① 只允许扣「我们为这张单建过的那张」PayPal 单。
    if (!order.paypalOrderId || order.paypalOrderId !== paypalOrderID) {
        return json({ error: "PAYPAL_ORDER_MISMATCH" }, { status: 403 });
    }

    let capture;
    try {
        capture = await paypalCaptureOrder(cfg, paypalOrderID, `capture-${paypalOrderID}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[paypal] capture 失败：", msg);
        // 单可能已被别处扣掉或过期：清掉存单 id，让用户能重新点（会建一张新的）。
        if (msg.includes("ORDER_NOT_APPROVED") || msg.includes("422")) {
            await setOrderPaypalOrderId(db, { orderId: order.id, paypalOrderId: null });
        }
        return json({ error: msg }, { status: 502 });
    }
    if (!capture) return json({ error: "PAYPAL_CAPTURE_UNPARSEABLE" }, { status: 502 });

    // ② custom_id 必须还是我们那张单。
    if (capture.orderNumber !== order.orderNumber) {
        console.error(`[paypal] custom_id 不符：期望 ${order.orderNumber} 实收 ${String(capture.orderNumber)}`);
        return json({ error: "CUSTOM_ID_MISMATCH" }, { status: 403 });
    }
    // ③ 金额必须等于订单应付。
    if (capture.status !== "COMPLETED") return json({ error: `CAPTURE_${capture.status}` }, { status: 409 });
    if (capture.amountCents !== order.totalCents) {
        return json({ error: `AMOUNT_MISMATCH:${String(capture.amountCents)}!=${order.totalCents}` }, { status: 409 });
    }

    try {
        await db.transaction((tx) =>
            recordPaymentSucceeded(tx, {
                orderId: order.id,
                provider: "paypal",
                providerRef: capture.captureId,
                amountCents: capture.amountCents ?? undefined,
            }),
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("PAYMENT_ALREADY_RECORDED")) return json({ status: "COMPLETED", alreadyRecorded: true });
        console.error("[paypal] 落账失败：", msg);
        return json({ error: "BOOKING_FAILED" }, { status: 500 });
    }

    return json({ status: "COMPLETED", captureId: capture.captureId });
}
