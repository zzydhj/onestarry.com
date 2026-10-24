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
    /**
     * 这笔钱属于哪张单。PSP 给的形式不一样，所以两个字段分开：
     * PayPal 只给 `custom_id`（我方可读单号）→ `orderNumber`；Fake 直接给内部 id → `orderId`。
     * 两者至多一个有值；都为 null 时上层**只能记账不能落账**（宁可不标已付，也不猜是哪张单）。
     */
    orderNumber: string | null;
    orderId: string | null;
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
        return {
            providerEventId: body.providerEventId,
            type: body.type,
            providerRef: body.providerRef ?? null,
            amountCents: body.amountCents ?? null,
            succeeded: body.succeeded ?? body.type === "payment.succeeded",
            orderNumber: body.orderNumber ?? null,
            orderId: body.orderId ?? null,
            raw: (body.raw ?? {}) as Record<string, unknown>,
        };
    }

    async refund(input: RefundInput): Promise<RefundResult> {
        return { providerRef: `fake_re_${input.providerRef}`, status: "succeeded" };
    }
}
