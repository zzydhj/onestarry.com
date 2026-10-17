import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, recordPaymentSucceeded, webhookEvents } from "@onestarry/db";
import { FakePaymentProvider, type NormalizedWebhookEvent, type PaymentProvider } from "@onestarry/core";

export const dynamic = "force-dynamic";

/**
 * PSP webhook 接收（§15 步骤 12b-2·A 骨架）。
 * 目前只有 FakePaymentProvider（无 PSP 账号）；拿到 Stripe/PayPal 测试密钥后，
 * 在 pickProvider 里按 env 换成真实实现即可，本路由与主干零改动。
 * 幂等：(provider, provider_event_id) 唯一，重复回调直接确认；成功支付 → recordPaymentSucceeded 落账。
 */
function pickProvider(_name: string): PaymentProvider {
    // TODO(12b-2·B): if (_name === "stripe" && env.STRIPE_SECRET_KEY) return new StripeProvider(...)
    return new FakePaymentProvider();
}

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }): Promise<Response> {
    const { provider: providerName } = await ctx.params;
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const provider = pickProvider(providerName);

    const raw = await req.text();
    const signature = req.headers.get("stripe-signature") ?? req.headers.get("paypal-transmission-sig") ?? "";

    let normalized: NormalizedWebhookEvent;
    try {
        normalized = await provider.verifyWebhook(raw, signature);
    } catch {
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
                const orderId = (normalized.raw as { orderId?: string }).orderId;
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
    } catch {
        return new Response("processing failed", { status: 500 });
    }

    return Response.json({ received: true });
}
