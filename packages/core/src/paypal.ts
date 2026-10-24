/**
 * core/paypal.ts —— PayPal「自行集成 / Advanced Control」的**纯逻辑**（无 IO，可单测）。
 *
 * 分层口径：这里只做「形状与数字」——金额字符串、请求体、响应解析、验签请求体、URL 白名单。
 * 真正打网络的部分在 `apps/web/lib/paypal.ts`（OAuth / create / capture / verify）。
 * 这样分是因为下面这些坑每一个都值得被单测钉住，而带 fetch 的函数在 CI 里不可测。
 *
 * 关键约定（照官方 Orders v2 / Webhooks v1 文档，2026-10 核对）：
 * - 我方订单用 `purchase_units[].custom_id` + `invoice_id` 锚定：create 与 capture 响应都会原样带回，
 *   是「PSP 那笔钱 ↔ 我们这条订单」的确定性关联，不靠前端回传的 orderID 猜。
 * - 金额是**字符串 + 2 位小数**（JPY 等 0 位小数币种例外），不是数字：浮点进支付接口是经典事故。
 * - `cert_url` 来自回调头，**不能直接信**：必须判它确实是 `*.paypal.com` 的 https 地址，
 *   否则攻击者可以递自己的证书让验签“成功”。
 */
import type { NormalizedWebhookEvent } from "./payments";

export type PaypalEnv = "sandbox" | "live";

/** 只有显式写 live 才算生产；缺省/乱值一律 sandbox（宁可测试也不误打生产）。 */
export function paypalEnv(raw: string | undefined): PaypalEnv {
    return raw?.trim().toLowerCase() === "live" ? "live" : "sandbox";
}

/** REST API 根（服务端用）。 */
export function paypalApiBase(env: PaypalEnv): string {
    return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/** JS SDK 根（浏览器用；与 API 域名不同，别混）。 */
export function paypalSdkRoot(env: PaypalEnv): string {
    return env === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";
}

export interface PaypalSdkUrlInput {
    clientId: string;
    currency: string;
    env: PaypalEnv;
    locale?: string;
    /** 我方订单号：进 SDK 的 data-attributes 便于排查（不参与鉴权）。 */
    orderNumber?: string;
}

/**
 * 拼 JS SDK 的 script URL。`client-id` 是**公开**的（PayPal 设计如此，浏览器要拿它建会话），
 * 真正的 `PAYPAL_SECRET` 永远只在服务端用 —— 这条边界必须清楚，否则会有人把 secret 塞进前端。
 */
export function paypalSdkUrl(input: PaypalSdkUrlInput): string {
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(input.clientId)) {
        throw new Error("PAYPAL_CLIENT_ID 形状不符（检查是否误填了 secret 或带了引号/换行）");
    }
    const q = new URLSearchParams({
        "client-id": input.clientId,
        currency: input.currency.toUpperCase(),
        intent: "capture",
        components: "buttons",
    });
    if (input.locale) q.set("locale", input.locale);
    return `${paypalSdkRoot(input.env)}/sdk/js?${q.toString()}`;
}

/** 0 位小数币种（PayPal 支持列表里最常遇到的两个）。 */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND"]);

/** 分 → PayPal 的金额字符串。 */
export function paypalAmountValue(cents: number, currency: string): string {
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`PAYPAL_BAD_AMOUNT:${String(cents)}`);
    const cur = currency.toUpperCase();
    return ZERO_DECIMAL.has(cur) ? String(cents) : (cents / 100).toFixed(2);
}

/** PayPal 金额字符串 → 分（严格解析：形状不对就拒，不做 Number() 兜底）。 */
export function paypalCentsFromValue(value: unknown, currency: unknown): number | null {
    if (typeof value !== "string" || typeof currency !== "string") return null;
    const cur = currency.toUpperCase();
    const re = ZERO_DECIMAL.has(cur) ? /^\d+$/ : /^\d+\.\d{2}$/;
    if (!re.test(value)) return null;
    return ZERO_DECIMAL.has(cur) ? Number(value) : Math.round(Number(value) * 100);
}

export interface PaypalOrderBodyInput {
    /** 我方可读单号：同时进 custom_id 与 invoice_id。 */
    orderNumber: string;
    amountCents: number;
    currency: string;
    /** 描述会显示在买家的 PayPal 账单上。 */
    description?: string;
    /** 支付完成/取消后 SDK 的跳转（我们走 onApprove 回调，这两项主要为 PayPal 页面兼容）。 */
    returnUrl?: string;
    cancelUrl?: string;
}

/**
 * 构造 `POST /v2/checkout/orders` 的请求体。
 *
 * `shipping_preference: "NO_SHIPPING"` 是有意的：收货地址在我们这边已经采集并固化进订单快照，
 * 再让 PayPal 弹它自己的地址表会出现「两个地址」的争议（客服最难处理的一类）。
 */
export function buildPaypalOrderBody(input: PaypalOrderBodyInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
        intent: "CAPTURE",
        purchase_units: [
            {
                reference_id: "1",
                custom_id: input.orderNumber,
                invoice_id: input.orderNumber,
                amount: {
                    currency_code: input.currency.toUpperCase(),
                    value: paypalAmountValue(input.amountCents, input.currency),
                },
                ...(input.description ? { description: input.description.slice(0, 127) } : {}),
            },
        ],
        application_context: {
            brand_name: "OneStarry",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
            ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
        },
    };
    return body;
}

/** PayPal 订单状态（Orders v2）。 */
export type PaypalOrderStatus = "CREATED" | "SAVED" | "APPROVED" | "COMPLETED" | "PAYER_ACTION_REQUIRED" | "VOIDED" | string;

/** 还没付完、可以复用同一张 PayPal 单继续走的状态（null = 查不到，也不能复用）。 */
export function isPaypalOrderReusable(status: PaypalOrderStatus | null | undefined): boolean {
    return status === "CREATED" || status === "PAYER_ACTION_REQUIRED" || status === "APPROVED";
}

/** 已经收到钱的标志（订单级）。 */
export function isPaypalOrderCompleted(status: PaypalOrderStatus | undefined): boolean {
    return status === "COMPLETED";
}

export interface PaypalCaptureResult {
    /** PayPal 订单 id（我们存进 orders.paypal_order_id 用于防重复建单）。 */
    paypalOrderId: string;
    /** capture id = 真正的资金交易号，进 payments.provider_ref。 */
    captureId: string;
    status: string;
    amountCents: number | null;
    currency: string | null;
    /** 我们带进去的单号；PSP 侧被改过就是 null（下面 extract 里会拒）。 */
    orderNumber: string | null;
}

/** PayPal 侧的 id（订单 / capture）都是大写字母数字与短横线。 */
const PP_ID_RE = /^[A-Z0-9_-]{6,64}$/;

/**
 * 从 create/capture 响应里取第一笔 capture。**任何一环不合法就返回 null**：
 * 这是外部 JSON 进入我们财务链路的唯一入口，宁可判失败也不猜。
 */
export function extractPaypalCapture(json: unknown): PaypalCaptureResult | null {
    const order = asObj(json);
    if (!order || typeof order.id !== "string" || !PP_ID_RE.test(order.id)) return null;
    const paypalOrderId = order.id;

    const units = Array.isArray(order.purchase_units) ? order.purchase_units : [];
    const unit = asObj(units[0]);
    if (!unit) return null;
    const payments = asObj(unit.payments);
    const captureList = Array.isArray(payments?.captures) ? payments.captures : [];
    const capture = asObj(captureList[0]);
    if (!capture || typeof capture.id !== "string" || !PP_ID_RE.test(capture.id)) return null;

    const amount = asObj(capture.amount);
    return {
        paypalOrderId,
        captureId: capture.id,
        status: typeof capture.status === "string" ? capture.status : "UNKNOWN",
        amountCents: paypalCentsFromValue(amount?.value, amount?.currency_code),
        currency: typeof amount?.currency_code === "string" ? amount.currency_code.toUpperCase() : null,
        orderNumber: typeof unit.custom_id === "string" ? unit.custom_id : null,
    };
}

/** 只读订单级状态（Show order details 用）。 */
export function extractPaypalOrderStatus(json: unknown): PaypalOrderStatus | null {
    const order = asObj(json);
    return order && typeof order.status === "string" ? order.status : null;
}

export interface PaypalVerifyInput {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    /** **订阅**的 webhook id（开发者后台那条 webhook 的 id，不是事件 id）。填错必验不过。 */
    webhookId: string;
    /** 原始事件对象：官方更新后要求把整个事件一起送进去算 CRC32。 */
    event: unknown;
}

/** `POST /v1/notifications/verify-webhook-signature` 的请求体。 */
export function paypalVerifySignatureBody(input: PaypalVerifyInput): Record<string, unknown> {
    return {
        auth_algo: input.authAlgo,
        cert_url: input.certUrl,
        transmission_id: input.transmissionId,
        transmission_sig: input.transmissionSig,
        transmission_time: input.transmissionTime,
        webhook_id: input.webhookId,
        webhook_event: input.event,
    };
}

/**
 * `cert_url` 白名单。回调头里的这个值是攻击者可写的，所以两条都要判：
 * ① 必须 https；② 主机必须以 `.paypal.com` **结尾且是它的一级子域**（`paypal.com.evil.tld` 必须拒）。
 */
export function isPaypalCertUrl(raw: string | null | undefined): boolean {
    if (!raw) return false;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "paypal.com" || host.endsWith(".paypal.com");
}

/** 我们关心的事件类型（其余照收进 webhook_events 但不落账）。 */
export const PAYPAL_CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED";
export const PAYPAL_CAPTURE_REVERSED = new Set(["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.FAILED", "PAYMENT.CAPTURE.REVERSED"]);

/**
 * PayPal 回调事件 → 我们的归一化形状。
 *
 * ⚠ 这里**不做**信任判定（验签在 IO 层用 PayPal 接口做）；但会拒掉形状不合的体，
 * 因为落账路径要吃 amountCents / orderNumber，让垃圾值流到那里比在这里报错贵得多。
 */
export function mapPaypalWebhookEvent(json: unknown): NormalizedWebhookEvent {
    const event = asObj(json);
    const eventId = typeof event?.id === "string" ? event.id : null;
    const eventType = typeof event?.event_type === "string" ? event.event_type : null;
    if (!event || !eventId || !eventType) throw new Error("PAYPAL_WEBHOOK_BAD_ENVELOPE");

    const resource = asObj(event.resource) ?? {};
    const amount = asObj(resource.amount);
    const amountCents = paypalCentsFromValue(amount?.value, amount?.currency_code);
    // capture 事件把 custom_id 放在 resource 上；订单类事件（CHECKOUT.ORDER.*）放在 purchase_units[0] 上。
    const units = Array.isArray(resource.purchase_units) ? resource.purchase_units : [];
    const firstUnit = asObj(units[0]);
    const customId =
        typeof resource.custom_id === "string"
            ? resource.custom_id
            : typeof firstUnit?.custom_id === "string"
                ? firstUnit.custom_id
                : null;

    const isCaptureCompleted = eventType === PAYPAL_CAPTURE_COMPLETED && resource.status === "COMPLETED";

    return {
        providerEventId: eventId,
        type: eventType,
        providerRef: typeof resource.id === "string" ? resource.id : null,
        amountCents,
        succeeded: isCaptureCompleted,
        orderNumber: customId,
        orderId: null, // PayPal 不给我们内部 id，只给 custom_id
        raw: event,
    };
}

function asObj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
