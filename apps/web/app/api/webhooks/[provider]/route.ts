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
    // 的入口。现在：paypal 且配齐凭据 → 真验签；显式开 FAKE_PAYMENTS_ENABLED=1 且 name 为专属 "fake" → 才接受假回调；否则 null。
    if (name === "paypal") {
        const cfg = readPaypalConfig(env);
        return cfg ? new PaypalPaymentProvider(cfg) : null;
    }
    // 审查 L-5：Fake 不验签，只能活在专属 slug `/webhooks/fake` 上，绝不让它冒充真实 provider 的路径。
    // 旧写法 `FAKE=1` 时**任意** name 都返回 Fake，包括未配凭据的 `/webhooks/paypal` 也会收未签名假回调
    //（危险组合：生产误开 FAKE + 有人打真实通道）。收窄后未配凭据的 paypal 一律 null→501（真实语义：paypal 未接入）。
    if (name === "fake" && env.FAKE_PAYMENTS_ENABLED === "1") return new FakePaymentProvider();
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

            // 状态由“钱是否真的落了账”决定，而非 outcome 静态映射（审查 H-1）。
            // 旧写法把非 ignored 一律预置成 processed，于是“paid 但定不到单”这条分支——
            // 注释亲手写了“宁可不标已付”——却把事件标成已处理：订单没错（没落账），
            // 但 webhook_events 显示 processed、无 error、无重投，后台据此以为处理完了。
            let status: "processed" | "ignored" | "failed" = normalized.outcome === "ignored" ? "ignored" : "processed";
            let error: string | null = null;

            // 先把“这张单是我们哪一笔”定下来：PSP 给的形式不一样，所以三条路都试。
            let orderId = normalized.orderId;
            if (!orderId && normalized.orderNumber) {
                const res = await getOrderByNumber(tx, normalized.orderNumber);
                orderId = res?.order.id ?? null;
                if (!orderId) console.warn(`[webhook:${providerName}] custom_id 对应的单不存在：${normalized.orderNumber}`);
            }

            if (normalized.outcome === "paid") {
                // 没定到单就只存事件不落账（宁可不标已付，也不猜是哪张单）。
                // 但必须标 failed + error：这才是一次没跑成、需人工看的事件，而不是“已处理”。
                // 回 200（不再重投：单不存在重投也不会好），靠 status=failed 进运维视野。
                if (orderId) {
                    await recordPaymentSucceeded(tx, {
                        orderId,
                        provider: providerName,
                        providerRef: normalized.providerRef ?? undefined,
                        amountCents: normalized.amountCents ?? undefined,
                        // 币种与金额成对上交（审查 L1）：PSP 说“收了一万”，还必须说“收的是什么钱”；
                        // 对不上就由下面的不可恢复分支落档停投，而不是拿别人币种的数字过我们的账。
                        currency: normalized.currency,
                    });
                } else {
                    status = "failed";
                    error = "ORDER_UNRESOLVED";
                }
            } else if (normalized.outcome === "revoked" || normalized.outcome === "refunded") {
                // 退款类事件的 resource 是**退款体**，常常不带 custom_id：
                // 只能拿 captureRef 去回溯我们存过的那笔收款，两个都递进去让查侧自己定。
                if (!orderId && !normalized.captureRef) {
                    // 无法关联原收款：既不冲账也不当已处理，标 ignored 留人工（钱的事实待核）。
                    console.warn(`[webhook:${providerName}] ${normalized.type} 无法关联到原收款，只存事件`);
                    status = "ignored";
                    error = "UNASSOCIATED";
                } else {
                    const res = await recordPaymentReversal(tx, {
                        provider: providerName,
                        orderId,
                        captureRef: normalized.captureRef,
                        kind: normalized.outcome,
                        amountCents: normalized.outcome === "refunded" ? normalized.amountCents : null,
                        // 冲账也要比币种（与正向落账同一口径）。
                        currency: normalized.currency,
                        refundRef: normalized.outcome === "refunded" ? normalized.providerRef : null,
                        reason: normalized.type,
                    });
                    // 没生过发票的单冲不出红字凭证：不阻断落账（钱的事实重要），但必须留痕。
                    if (!res.creditNoteNumber) {
                        console.warn(`[webhook:${providerName}] ${normalized.type} 已冲账但无发票可冲：order=${res.orderId} amount=${res.amountCents}`);
                    }
                }
            }
            await tx
                .update(webhookEvents)
                .set({ status, error, processedAt: new Date() })
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
            // 审查 L5：旧写法直接 return，但上面的事务已连同 `webhook_events` 那次 INSERT 一起回滚
            // → “PSP 拿另一个 event_id 告诉过我们一次”这个事实在库里零留痕（只能去挖日志）。
            // 现补一条 durably 提交的收据（独立于已回滚的业务事务）：什么都没改是**结论**，不是事故，
            // 所以 status=processed + error 记名；重投同一个 event_id 时会靠唯一索引幂等跳过。
            console.warn(`[webhook:${providerName}] 重复回调（已落账过）：${msg}`);
            await db
                .insert(webhookEvents)
                .values({
                    provider: providerName,
                    providerEventId: normalized.providerEventId,
                    type: normalized.type,
                    payload: normalized.raw,
                    status: "processed",
                    error: `DUPLICATE_REPLAY:${msg}`,
                    processedAt: new Date(),
                })
                .onConflictDoNothing();
            return Response.json({ received: true, duplicate: true });
        }
        // 审查 M-8：把「重投一万次也不会好」的不可恢复错误，与「重投能补」的可恢复错误分开处理。
        // 不可恢复 = 我方记账不变量 / 数据不变量被破（金额≠应付、借贷不平、内部插入/事务失败、市场缺失、
        // captureRef 多义、超额退款）。旧写法它们一律回 500 → 事务连同 event 行一起回滚（运维在
        // webhook_events 里看不到）→ PSP 按退避重投整整 3 天、每次跑完整事务再回滚：既无谓轰炸、又零审计痕迹。
        // 现：将失败 **durably 写进 event 行**（独立提交、不随已回滚的业务事务丢，status=failed+error）后回 200
        // 确认收到（停掉 3 天重投），靠 status=failed（走 wh_status_idx）进运维视野。钱没落账、单仍 unpaid，不会误标已付。
        const UNRECOVERABLE = [
            "PAYMENT_AMOUNT_MISMATCH",
            // 审查 L1：币种对不上也是“重投一万次也不会好”（PSP 报的币种不会因重投而变），
            // 归不可恢复：落档 + 停投，由人工核。静默落成另一种钱就是账本错数。
            "PAYMENT_CURRENCY_MISMATCH",
            "REVERSAL_CURRENCY_MISMATCH",
            "LEDGER_IMBALANCE",
            "PAYMENT_INSERT_FAILED",
            "LEDGER_TXN_FAILED",
            "MARKET_NOT_FOUND",
            "PAYMENT_AMBIGUOUS",
            "REVERSAL_AMOUNT_OVER",
            // 审查 L2：单已被未付过期回收置 cancelled（预留已释放）→ 重投一万次也不会变成可履约，
            // 绝不能当成“可恢复错误”让 PSP 打三天重投，也绝不能静默置 paid（那是超卖）。
            // 停投 + 落档后由人工退款（钱真的到了，但本仓还没有退款通道，见 §9）。
            "ORDER_CANCELLED",
        ];
        if (UNRECOVERABLE.some((c) => msg.startsWith(c))) {
            console.error(`[webhook:${providerName}] 不可恢复错误，已落档并停投：${msg}`);
            await db
                .insert(webhookEvents)
                .values({
                    provider: providerName,
                    providerEventId: normalized.providerEventId,
                    type: normalized.type,
                    payload: normalized.raw,
                    status: "failed",
                    error: msg,
                    processedAt: new Date(),
                })
                .onConflictDoNothing(); // 并发重投同行已存则幂等跳过
            return Response.json({ received: true });
        }
        // 其余（PAYMENT_NOT_FOUND 时序竞态、ORDER_NOT_FOUND、以及任何未知/基建错误）默认回 500 让 PSP 重投：
        // 宁可多试，也绝不确认一个我们没真正处理成功的事件（误标“已处理”会把钱弄丢）。event 行随事务回滚，重投时重新处理。
        console.error(`[webhook:${providerName}] 处理失败：`, e instanceof Error ? e.message : e);
        return new Response("processing failed", { status: 500 });
    }

    return Response.json({ received: true });
}
