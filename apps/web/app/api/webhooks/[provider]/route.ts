import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
    createDb,
    getOrderByNumber,
    recordPaymentReversal,
    recordPaymentSucceeded,
    webhookEvents,
} from "@onestarry/db";
import { FakePaymentProvider, type NormalizedWebhookEvent, type PaymentProvider } from "@onestarry/core";
import { PaypalPaymentProvider, paypalWriteBlocked, readPaypalConfig } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PSP webhook 接收（§15 步骤 12b-2）。
 *
 * 钱的正反两个方向都从这里进：`paid` 落账，`revoked` / `refunded` 冲账，`ignored` 只存事件。
 * 反向那两条只能靠 webhook —— 钱是 PayPal 主动收回的（DENIED / REVERSED）或已经退出我们的（REFUNDED），
 * 我们自己的请求永远看不见。**没有反向通道，就是「撤了钱的单照发货到」**。
 *
 * 幂等：(provider, provider_event_id) 唯一，重复回调直接确认；重放又换 event_id 的那批
 * 由 `recordPaymentSucceeded` / `recordPaymentReversal` 自己的业务约束接住。
 */
/** 单次回调体上限：Stripe/PayPal 最大事件也远小于此，但挡住有人拿它灌 webhook_events 表。 */
const MAX_BODY_BYTES = 256 * 1024;

function pickProvider(env: CloudflareEnv, name: string): PaymentProvider | null {
    // TODO(12b-2·B): if (name === "stripe" && env.STRIPE_SECRET_KEY) return new StripeProvider(...)
    //
    // ⚠ 默认值必须是「不收」。旧实现无条件返回 FakePaymentProvider，而 Fake 的
    // verifyWebhook **根本不看签名** —— 那等于在公网上开了一个「把任意订单标成已付 + 生成发票 + 记账本」
    // 的入口。现在：paypal 且配齐凭据 → 真验签；显式开 FAKE_PAYMENTS_ENABLED=1 → 才接受假回调；否则 null。
    if (name === "paypal") {
        const cfg = readPaypalConfig(env);
        return cfg ? new PaypalPaymentProvider(cfg) : null;
    }
    if (env.FAKE_PAYMENTS_ENABLED === "1") return new FakePaymentProvider();
    return null;
}

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }): Promise<Response> {
    const { provider: providerName } = await ctx.params;
    const { env } = getCloudflareContext();

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });

    const provider = pickProvider(env, providerName);
    if (!provider) {
        // 501 而不是 401：这不是「你身份不对」，是「本服务还没接 PSP」，运维看状态码就能定位。
        return new Response("no payment provider configured", { status: 501 });
    }
    const db = createDb(env.HYPERDRIVE.connectionString);

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });

    let normalized: NormalizedWebhookEvent;
    try {
        normalized = await provider.verifyWebhook(raw, req.headers);
    } catch (e) {
        // 验签失败不写事件表：那会变成一个可以任意灌的垃圾表。原因进日志供排错。
        console.warn(`[webhook:${providerName}] 验签/解析失败：`, e instanceof Error ? e.message : e);
        return new Response("invalid signature/payload", { status: 400 });
    }

    // 拿沙箱凭据改生产账：同样挡住。回 503 让 PayPal 重投 —— 配好后重投就能补上，比丢事件好。
    const paypalCfg = readPaypalConfig(env);
    if (paypalCfg && normalized.outcome !== "ignored") {
        const blocked = paypalWriteBlocked(paypalCfg, env.PAYPAL_ALLOW_SANDBOX);
        if (blocked) {
            console.warn(`[webhook:${providerName}] ${blocked}：事件 ${normalized.type} 未落账，等配好后 PayPal 重投`);
            return new Response(blocked, { status: 503 });
        }
    }

    // 只存不动账的事件一律标 ignored，后台看事件表时能直接分出“哪些还得人工看”。
    const nextStatus = normalized.outcome === "ignored" ? "ignored" : "processed";

    try {
        await db.transaction(async (tx) => {
            const ins = await tx
                .insert(webhookEvents)
                .values({
                    provider: providerName,
                    providerEventId: normalized.providerEventId,
                    type: normalized.type,
                    payload: normalized.raw,
                })
                .onConflictDoNothing()
                .returning();
            const inserted = ins[0];
            if (!inserted) return; // 重复回调，幂等跳过

            // 先把“这张单是我们哪一笔”定下来：PSP 给的形式不一样，所以三条路都试。
            let orderId = normalized.orderId;
            if (!orderId && normalized.orderNumber) {
                const res = await getOrderByNumber(tx, normalized.orderNumber);
                orderId = res?.order.id ?? null;
                if (!orderId) console.warn(`[webhook:${providerName}] custom_id 对应的单不存在：${normalized.orderNumber}`);
            }

            if (normalized.outcome === "paid") {
                // 没定到单就只存事件不落账（宁可不标已付，也不猜是哪张单）。
                if (orderId) {
                    await recordPaymentSucceeded(tx, {
                        orderId,
                        provider: providerName,
                        providerRef: normalized.providerRef ?? undefined,
                        amountCents: normalized.amountCents ?? undefined,
                    });
                }
            } else if (normalized.outcome === "revoked" || normalized.outcome === "refunded") {
                // 退款类事件的 resource 是**退款体**，常常不带 custom_id：
                // 只能拿 captureRef 去回溯我们存过的那笔收款，两个都递进去让查侧自己定。
                if (!orderId && !normalized.captureRef) {
                    console.warn(`[webhook:${providerName}] ${normalized.type} 无法关联到原收款，只存事件`);
                    await tx
                        .update(webhookEvents)
                        .set({ status: "ignored", processedAt: new Date() })
                        .where(eq(webhookEvents.id, inserted.id));
                    return;
                }
                const res = await recordPaymentReversal(tx, {
                    provider: providerName,
                    orderId,
                    captureRef: normalized.captureRef,
                    kind: normalized.outcome,
                    amountCents: normalized.outcome === "refunded" ? normalized.amountCents : null,
                    refundRef: normalized.outcome === "refunded" ? normalized.providerRef : null,
                    reason: normalized.type,
                });
                // 没生过发票的单冲不出红字凭证：不阻断落账（钱的事实重要），但必须留痕。
                if (!res.creditNoteNumber) {
                    console.warn(`[webhook:${providerName}] ${normalized.type} 已冲账但无发票可冲：order=${res.orderId} amount=${res.amountCents}`);
                }
            }
            await tx
                .update(webhookEvents)
                .set({ status: nextStatus, processedAt: new Date() })
                .where(eq(webhookEvents.id, inserted.id));
        });
    } catch (e) {
        // 同一订单重复落账/重复冲账：对 PSP 而言是正常重放，确认收到即可，不要回 500 让它一直重试。
        const msg = e instanceof Error ? e.message : String(e);
        if (
            msg.startsWith("PAYMENT_ALREADY_RECORDED") ||
            msg.startsWith("PAYMENT_ALREADY_REVERSED") ||
            msg.startsWith("REVERSAL_ALREADY_SETTLED")
        ) {
            return Response.json({ received: true, duplicate: true });
        }
        // PAYMENT_NOT_FOUND 故意不归到 duplicate：冲账比落账先到是可能的（时间差、重投顺序），
        // 回 500 让事务连同事件行一起回滚，PayPal 重投后就能处到。误标“已处理”反而会把钱弄丢。
        console.error(`[webhook:${providerName}] 处理失败：`, e instanceof Error ? e.message : e);
        return new Response("processing failed", { status: 500 });
    }

    return Response.json({ received: true });
}
