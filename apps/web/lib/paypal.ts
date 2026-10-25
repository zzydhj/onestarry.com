import {
    buildPaypalOrderBody,
    extractPaypalCapture,
    extractPaypalOrderStatus,
    isPaypalCertUrl,
    mapPaypalWebhookEvent,
    paypalApiBase,
    paypalEnv,
    paypalSandboxBlocked,
    paypalVerifySignatureBody,
    type CheckoutSession,
    type CreateCheckoutInput,
    type NormalizedWebhookEvent,
    type PaymentProvider,
    type PaypalCaptureResult,
    type PaypalEnv,
    type RefundInput,
    type RefundResult,
    type WebhookHeaders,
} from "@onestarry/core";

/**
 * PayPal「自行集成 / Advanced Control」的**服务端 IO 层**（Orders v2 + OAuth + 回调验签）。
 *
 * 分层：形状与数字都在 `@onestarry/core/paypal`（有单测），这里只负责「打网络 + 管 token」。
 * 为什么不引官方 SDK：`@paypal/paypal-server-sdk` 是 Node 形态的包，跑在 Workers 上要靠兼容层，
 * 而我们要的就四个端点 —— 直接 fetch 更少依赖、更好审、也不会哪天因为 SDK 换实现方式重做一遍。
 *
 * ⚠ 三条硬规矩（每条都对应一类真实事故）：
 *   1. **金额只从库里取**：前端传来的任何金额都不参与建 PayPal 单；
 *   2. **capture 前核对 PayPal 单归属**：`custom_id` 必须等于我方单号，且必须是我们存过的那张 PayPal 单，
 *      否则前端可以把「别人那张已批准的单」递过来让我们替他入账；
 *   3. **验签失败就抛**：宁可让 PayPal 重投，也不能把假通知写进账本。
 */

export interface PaypalConfig {
    clientId: string;
    secret: string;
    env: PaypalEnv;
    /** 订阅 webhook 的 id（开发者后台那条 webhook 的 id）。缺省时无法验签 → 一律拒收。 */
    webhookId: string | null;
}

/** 未配置就是未配置：**返回 null 让调用方 fail-closed**，不要在这里兜一个假值。 */
export function readPaypalConfig(env: CloudflareEnv): PaypalConfig | null {
    const clientId = env.PAYPAL_CLIENT_ID?.trim();
    const secret = env.PAYPAL_SECRET?.trim();
    if (!clientId || !secret) return null;
    return { clientId, secret, env: paypalEnv(env.PAYPAL_ENV), webhookId: env.PAYPAL_WEBHOOK_ID?.trim() || null };
}

/**
 * 「能不能拿这套凭据动账」的闸：`live` 永远可以；`sandbox` 必须显式开 `PAYPAL_ALLOW_SANDBOX=1`。
 *
 * 为什么需要它（而不是写在文档里靠自觉）：沙箱里走完一笔“真流程”，我们的三道闸全部会过 ——
 * 那张 PayPal 单确实是我们建的、`custom_id` 与金额也都对得上 ——
 * 但它一分钱都没付。拿沙箱凭据挂在线上 Worker 上测，就能把客户的真单标成已付并发货。
 * 本地开发在 `.dev.vars` 里给 1，线上默认没有；要拿沙箱改生产账就显式开、测完删。
 *
 * @returns `null` = 允许；否则是错误码，直接回给调用方。
 */
export function paypalWriteBlocked(cfg: PaypalConfig, allowSandbox: string | undefined): string | null {
    return paypalSandboxBlocked(cfg.env, allowSandbox) ? "PAYPAL_SANDBOX_NOT_ALLOWED" : null;
}

const API_TIMEOUT_MS = 15_000;
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * OAuth access token 缓存（**per isolate**）。
 * PayPal 的 token 默认 9 小时有效，每次请求都去换会白加一个跨洋 RTT（~200ms+）。
 * 提前 60 秒刷新，避免刚好卡在过期边界上失败；收到 401 时由调用方清缓存重试一次。
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

export function clearPaypalTokenCache(): void {
    cachedToken = null;
}

async function accessToken(cfg: PaypalConfig): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

    const res = await fetch(`${paypalApiBase(cfg.env)}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.secret}`)}`,
            "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
        // 不把响应体拼进错误信息：那里面可能带凭据相关的提示，而错误会被 console 打出来。
        throw new Error(`PAYPAL_AUTH_FAILED:${res.status}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("PAYPAL_AUTH_FAILED:no_access_token");
    const ttlMs = Math.max(60, Number(json.expires_in ?? 3600) - 120) * 1000;
    cachedToken = { value: json.access_token, expiresAt: now + ttlMs };
    return cachedToken.value;
}

/** 带 token 的 API 调用；401 时清缓存重试一次（时钟漂移或后台手动吊销都会撞到）。 */
async function apiFetch(cfg: PaypalConfig, path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await fetch(`${paypalApiBase(cfg.env)}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${await accessToken(cfg)}`,
            "content-type": "application/json",
            ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 401 && retry) {
        clearPaypalTokenCache();
        return apiFetch(cfg, path, init, false);
    }
    return res;
}

/** 查 PayPal 单状态（Show order details）。404 → null。 */
export async function paypalShowOrder(cfg: PaypalConfig, paypalOrderId: string): Promise<{ status: string | null; json: unknown }> {
    const res = await apiFetch(cfg, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
    if (res.status === 404) return { status: null, json: null };
    if (!res.ok) throw new Error(`PAYPAL_SHOW_FAILED:${res.status}`);
    const json = await res.json();
    return { status: extractPaypalOrderStatus(json), json };
}

/**
 * 建 PayPal 单。`paypalRequestId` 是 PayPal 的**幂等键**（`PayPal-Request-Id`）：
 * 同一把键重复提交只会拿到同一张 PayPal 单 —— 这是「用户狂点按钮」不会造出多笔可扣款单的那道闸。
 */
export async function paypalCreateOrder(
    cfg: PaypalConfig,
    input: { orderNumber: string; amountCents: number; currency: string; description?: string; returnUrl?: string; cancelUrl?: string; paypalRequestId: string },
): Promise<{ paypalOrderId: string; status: string | null }> {
    const res = await apiFetch(cfg, "/v2/checkout/orders", {
        method: "POST",
        headers: { "paypal-request-id": input.paypalRequestId },
        body: JSON.stringify(
            buildPaypalOrderBody({
                orderNumber: input.orderNumber,
                amountCents: input.amountCents,
                currency: input.currency,
                description: input.description,
                returnUrl: input.returnUrl,
                cancelUrl: input.cancelUrl,
            }),
        ),
    });
    if (!res.ok) throw new Error(`PAYPAL_CREATE_FAILED:${res.status}`);
    const json = (await res.json()) as { id?: string; status?: string };
    if (typeof json.id !== "string") throw new Error("PAYPAL_CREATE_FAILED:no_id");
    return { paypalOrderId: json.id, status: typeof json.status === "string" ? json.status : null };
}

/** 扣款（Capture payment）。返回解析后的 capture；不合法体返回 null。 */
export async function paypalCaptureOrder(cfg: PaypalConfig, paypalOrderId: string, paypalRequestId: string): Promise<PaypalCaptureResult | null> {
    const res = await apiFetch(cfg, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: "POST",
        headers: { "paypal-request-id": paypalRequestId },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        // 把 PayPal 的 issue 码带出来（只取白名单字段，避免把整坨响应塞进日志）。
        const detail = (json as { details?: { issue?: string }[] } | null)?.details?.[0]?.issue;
        throw new Error(`PAYPAL_CAPTURE_FAILED:${res.status}${detail ? ":" + detail : ""}`);
    }
    return extractPaypalCapture(json);
}

/**
 * 回调验签：把五条头 + 整个事件送回 PayPal 自己判（官方推荐路径，比我们自己拉证书稳）。
 * 任何一环不合就抛 —— 缺头、cert_url 不是 paypal 域、webhookId 没配、PayPal 说 FAILURE。
 */
export async function paypalVerifyWebhook(cfg: PaypalConfig, headers: WebhookHeaders, rawBody: string): Promise<NormalizedWebhookEvent> {
    const get = (n: string) => headers.get(n)?.trim() ?? "";
    const transmissionId = get("paypal-transmission-id");
    const transmissionTime = get("paypal-transmission-time");
    const certUrl = get("paypal-cert-url");
    const transmissionSig = get("paypal-transmission-sig");
    const authAlgo = get("paypal-auth-algo");
    if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig || !authAlgo) {
        throw new Error("PAYPAL_WEBHOOK_MISSING_HEADERS");
    }
    if (!isPaypalCertUrl(certUrl)) throw new Error("PAYPAL_WEBHOOK_BAD_CERT_URL");
    if (!cfg.webhookId) throw new Error("PAYPAL_WEBHOOK_ID_NOT_CONFIGURED");

    const event = JSON.parse(rawBody) as unknown;
    const res = await apiFetch(cfg, "/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: JSON.stringify(
            paypalVerifySignatureBody({
                authAlgo,
                certUrl,
                transmissionId,
                transmissionSig,
                transmissionTime,
                webhookId: cfg.webhookId,
                event,
            }),
        ),
    });
    if (!res.ok) throw new Error(`PAYPAL_WEBHOOK_VERIFY_FAILED:${res.status}`);
    const verdict = (await res.json()) as { verification_status?: string };
    if (verdict.verification_status !== "SUCCESS") throw new Error("PAYPAL_WEBHOOK_VERIFY_NOT_SUCCESS");

    return mapPaypalWebhookEvent(event);
}

/**
 * PayPal 的 PaymentProvider 实现。
 *
 * `createCheckout` 保留给通用接缝（返回 PayPal 单 id 与 approval 链接），
 * 但本站的支付页走的是「SDK 按钮 → 我们的 create/capture 路由」，因为资金动作必须在服务端发生。
 */
export class PaypalPaymentProvider implements PaymentProvider {
    readonly name = "paypal";

    constructor(private readonly cfg: PaypalConfig) { }

    get env(): PaypalEnv {
        return this.cfg.env;
    }

    get clientId(): string {
        return this.cfg.clientId;
    }

    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
        const created = await paypalCreateOrder(this.cfg, {
            orderNumber: input.metadata?.orderNumber ?? input.orderId,
            amountCents: input.amountCents,
            currency: input.currency,
            returnUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
            paypalRequestId: `checkout-${input.orderId}`,
        });
        return { provider: this.name, providerRef: created.paypalOrderId, url: input.successUrl };
    }

    verifyWebhook(rawBody: string, headers: WebhookHeaders): Promise<NormalizedWebhookEvent> {
        return paypalVerifyWebhook(this.cfg, headers, rawBody);
    }

    async refund(input: RefundInput): Promise<RefundResult> {
        // 退款表与流程还没做（文档 T 项）；这里显式不支持，别让人以为已经能退。
        void input;
        throw new Error("PAYPAL_REFUND_NOT_IMPLEMENTED");
    }

    capture(paypalOrderId: string, paypalRequestId: string): Promise<PaypalCaptureResult | null> {
        return paypalCaptureOrder(this.cfg, paypalOrderId, paypalRequestId);
    }

    show(paypalOrderId: string): Promise<{ status: string | null; json: unknown }> {
        return paypalShowOrder(this.cfg, paypalOrderId);
    }
}
