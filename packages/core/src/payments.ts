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

/** 归一化后的 webhook 事件（各 PSP 原始事件翻成统一形状供上层消费）。 */
export interface NormalizedWebhookEvent {
    providerEventId: string;
    type: string;
    providerRef: string | null;
    amountCents: number | null;
    succeeded: boolean;
    raw: Record<string, unknown>;
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

export interface PaymentProvider {
    readonly name: string;
    createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
    /** 验签 + 解析原始回调体；验签失败应抛错。 */
    verifyWebhook(rawBody: string, signature: string): Promise<NormalizedWebhookEvent>;
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

    async verifyWebhook(rawBody: string, _signature: string): Promise<NormalizedWebhookEvent> {
        const body = JSON.parse(rawBody) as Partial<NormalizedWebhookEvent> & { providerEventId?: string; type?: string };
        if (!body.providerEventId || !body.type) throw new Error("FAKE_WEBHOOK_BAD_PAYLOAD");
        return {
            providerEventId: body.providerEventId,
            type: body.type,
            providerRef: body.providerRef ?? null,
            amountCents: body.amountCents ?? null,
            succeeded: body.succeeded ?? body.type === "payment.succeeded",
            raw: (body.raw ?? {}) as Record<string, unknown>,
        };
    }

    async refund(input: RefundInput): Promise<RefundResult> {
        return { providerRef: `fake_re_${input.providerRef}`, status: "succeeded" };
    }
}
