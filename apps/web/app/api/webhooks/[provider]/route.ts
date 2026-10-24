import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, getOrderByNumber, recordPaymentSucceeded, webhookEvents } from "@onestarry/db";
import { FakePaymentProvider, type NormalizedWebhookEvent, type PaymentProvider } from "@onestarry/core";
import { PaypalPaymentProvider, readPaypalConfig } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PSP webhook 接收（§15 步骤 12b-2·A 骨架）。
 * 目前只有 FakePaymentProvider（无 PSP 账号）；拿到 Stripe/PayPal 测试密钥后，
 * 在 pickProvider 里按 env 换成真实实现即可，本路由与主干零改动。
 * 幂等：(provider, provider_event_id) 唯一，重复回调直接确认；成功支付 → recordPaymentSucceeded 落账。
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

            if (normalized.succeeded) {
                // PSP 给哪个标识就查哪个：PayPal 只给 custom_id（我方单号），Fake 直接给内部 id。
                // 两个都没 → 只存事件不落账（宁可不标已付，也不猜是哪张单）。
                let orderId = normalized.orderId;
                if (!orderId && normalized.orderNumber) {
                    const res = await getOrderByNumber(tx, normalized.orderNumber);
                    orderId = res?.order.id ?? null;
                    if (!orderId) console.warn(`[webhook:${providerName}] custom_id 对应的单不存在：${normalized.orderNumber}`);
                }
                if (orderId) {
                    await recordPaymentSucceeded(tx, {
                        orderId,
                        provider: providerName,
                        providerRef: normalized.providerRef ?? undefined,
                        amountCents: normalized.amountCents ?? undefined,
                    });
                }
            }
            await tx
                .update(webhookEvents)
                .set({ status: "processed", processedAt: new Date() })
                .where(eq(webhookEvents.id, inserted.id));
        });
    } catch (e) {
        // 同一订单重复落账：对 PSP 而言是正常重放，确认收到即可，不要回 500 让它一直重试。
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("PAYMENT_ALREADY_RECORDED")) return Response.json({ received: true, duplicate: true });
        return new Response("processing failed", { status: 500 });
    }

    return Response.json({ received: true });
}
