/**
 * core/payments.ts —— PaymentProvider 可插拔接缝（§7 / §15 步骤 12b-2 预留）
 *
 * 目的：把"收款/退款/回调验签"抽象成接口，Stripe/PayPal 各自实现；无账号时用 FakePaymentProvider。
 * 以后叠加真实 PSP = 实现本接口 + 配密钥 + 指 webhook，主干与结账流程零改动。
 * 落账由 db 侧 recordPaymentSucceeded 承接（webhook 消费时调用），本层只管 PSP 交互。
 */

export interface CreateCheckoutInput {
    orderId: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
}

export interface CheckoutSession {
    provider: string;
    /** PSP 侧会话/意图引用（如 Stripe PaymentIntent id）。 */
    providerRef: string;
    /** 前端跳转收款用（Stripe 用 clientSecret，PayPal 用 approvalUrl）。 */
    clientSecret?: string;
    url?: string;
}

/**
 * 事件对「这笔钱现在到底归谁」的归一判定。
 * 为什么不是一个 `succeeded` 布尔：钱的状态是四向的，不是两向的 ——
 * 「收到钱」「钱被收回」「钱被退掉」「与本局无关」用真假判不出来，
 * 而这三者在我们这边要做的事完全不同（落账 / 回退 / 冲账 + 出红字发票 / 什么都不做）。
 */
export type PaymentOutcome = "paid" | "revoked" | "refunded" | "ignored";

/**
 * 归一化后的 webhook 事件（各 PSP 原始事件翻成统一形状供上层消费）。
 */
export interface NormalizedWebhookEvent {
    providerEventId: string;
    type: string;
    /** 事件主体自己的交易号：capture 事件是 capture id，退款事件是**退款 id**。 */
    providerRef: string | null;
    amountCents: number | null;
    succeeded: boolean;
    /** 见 `PaymentOutcome`：落账与冲账都按它分派。 */
    outcome: PaymentOutcome;
    /**
     * 这笔事件背后的 **capture id**（原收款交易号，= 我们存进 `payments.provider_ref` 的值）。
     * 单独要它的理由：退款类事件的 `resource` 是退款体，`providerRef` 是退款号，
     * 不从这里回溯就找不着原那笔收款，钱退了而账冲不到位置上。
     */
    captureRef: string | null;
    /**
     * 这笔钱属于哪张单。PSP 给的形式不一样，所以两个字段分开：
     * PayPal 只给 `custom_id`（我方可读单号）→ `orderNumber`；Fake 直接给内部 id → `orderId`。
     * 两者至多一个有值；都为 null 时上层**只能记账不能落账**（宁可不标已付，也不猜是哪张单）。
     */
    orderNumber: string | null;
    orderId: string | null;
    raw: Record<string, unknown>;
}

/**
 * 冲销分摊：把「本次要冲多少钱」按原收款的构成摊到三个贷项上。
 *
 * 为什么需要它而不是直接按顺列冲：原收款是一组分录（货+运费 / 税 / 关），
 * 部分退款只拆走一部分 —— 浮点除法必然出现尾差，而尾差直接违反借贷平衡（整笔事务报错回滚，
 * 退款事件就永远落不下去）。所以这里用**向下取整 + 余数给最大项**，
 * 硬保证 `gross + tax + duty === amountCents`，让平衡成为恒等式而不是运气。
 *
 * ⚠ 这是**按比例摊**，不是逐行退货的真实拆分（那样需要订单行级退款数据，本站尚未做）；
 * 它保证的是账本平、金额对得上，而税/关的内部构成会是近似值。货型退款请走行级冲销那一步。
 */
export interface ReversalSplit {
    grossCents: number;
    taxCents: number;
    dutyCents: number;
}

export function splitReversal(base: ReversalSplit, baseTotalCents: number, amountCents: number): ReversalSplit {
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error(`REVERSAL_BAD_AMOUNT:${String(amountCents)}`);
    if (amountCents === 0) return { grossCents: 0, taxCents: 0, dutyCents: 0 };
    const parts = [base.grossCents, base.taxCents, base.dutyCents];
    if (parts.some((v) => !Number.isSafeInteger(v) || v < 0)) throw new Error("REVERSAL_BAD_BASE");

    const total = baseTotalCents > 0 ? baseTotalCents : parts.reduce((s, v) => s + v, 0);
    if (total <= 0) {
        // 原收款没构成可摊（全零或脏数据）：全部归货物项，宁可粗也要保平。
        return { grossCents: amountCents, taxCents: 0, dutyCents: 0 };
    }

    const scaled = parts.map((v) => Math.floor((v * amountCents) / total));
    // 向下取整只会少不会多，余数全部给当前最大的一项：它在占比上本来就离真值最远，补这里误差最小。
    const rest = amountCents - scaled.reduce((s, v) => s + v, 0);
    if (rest > 0) {
        let idx = 0;
        for (let i = 1; i < scaled.length; i++) if ((scaled[i] ?? 0) > (scaled[idx] ?? 0)) idx = i;
        scaled[idx] = (scaled[idx] ?? 0) + rest;
    }
    return { grossCents: scaled[0] ?? 0, taxCents: scaled[1] ?? 0, dutyCents: scaled[2] ?? 0 };
}

export interface RefundInput {
    providerRef: string;
    amountCents: number;
    reason?: string;
}

export interface RefundResult {
    providerRef: string;
    status: string;
}

/**
 * 回调头的最小形状（不用 Workers/DOM 的 `Headers` 类型：core 不开那些 lib，
 * 而且验签逻辑只用到 `get(name)`，给它一个结构类型反而能单测）。
 */
export interface WebhookHeaders {
    get(name: string): string | null;
}

export interface PaymentProvider {
    readonly name: string;
    createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
    /**
     * 验签 + 解析原始回调体；验签失败应抛错。
     * 传整个 header 集合而不是单条签名：Stripe 只要一个 `stripe-signature`，
     * 而 PayPal 要五条（transmission id/time、cert url、sig、auth algo）。
     */
    verifyWebhook(rawBody: string, headers: WebhookHeaders): Promise<NormalizedWebhookEvent>;
    refund(input: RefundInput): Promise<RefundResult>;
}

/**
 * 开发/测试用假 Provider：不触网、确定性强，让结账→回调→落账链路在无 PSP 账号时即可端到端跑通。
 * 生产按 env 选 Stripe/PayPal 实现替换它。
 */
export class FakePaymentProvider implements PaymentProvider {
    readonly name = "fake";

    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
        return {
            provider: this.name,
            providerRef: `fake_pi_${input.orderId}`,
            clientSecret: `fake_secret_${input.orderId}`,
        };
    }

    async verifyWebhook(rawBody: string, _headers: WebhookHeaders): Promise<NormalizedWebhookEvent> {
        const body = JSON.parse(rawBody) as Partial<NormalizedWebhookEvent> & { providerEventId?: string; type?: string };
        if (!body.providerEventId || !body.type) throw new Error("FAKE_WEBHOOK_BAD_PAYLOAD");
        const succeeded = body.succeeded ?? body.type === "payment.succeeded";
        return {
            providerEventId: body.providerEventId,
            type: body.type,
            providerRef: body.providerRef ?? null,
            amountCents: body.amountCents ?? null,
            succeeded,
            // 假回调也要能驱动反向链路，否则「退款落账」在本地与冒烟里根本测不到；
            // 缺省按 succeeded 推，显式给了就以显式为准。
            outcome: body.outcome ?? (succeeded ? "paid" : "ignored"),
            captureRef: body.captureRef ?? body.providerRef ?? null,
            orderNumber: body.orderNumber ?? null,
            orderId: body.orderId ?? null,
            raw: (body.raw ?? {}) as Record<string, unknown>,
        };
    }

    async refund(input: RefundInput): Promise<RefundResult> {
        return { providerRef: `fake_re_${input.providerRef}`, status: "succeeded" };
    }
}
