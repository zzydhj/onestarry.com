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
import type { NormalizedWebhookEvent, PaymentOutcome } from "./payments";

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

/**
 * capture 生命周期事件名（逐字照 developer.paypal.com「Webhook event names」）。
 * 必须逐字对：错一个字母的代价不是「报错」，而是**静默地归到 ignored** ——
 * 钱已被 PayPal 收回，我们系统里还显示已付、货照发。所以名字集中在这一处，不分散到路由里。
 * （旧版本这里还写了 `PAYMENT.CAPTURE.FAILED`，官方列表里没这个名，已删 —— 宁缺不假编。）
 */
export const PAYPAL_CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED";

/** 钱从未到账，或已到账又被 PayPal 收回：订单必须回到未收钱的状态。 */
const PAYPAL_REVOKED = new Set(["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REVERSED", "CHECKOUT.PAYMENT-APPROVAL.REVERSED"]);
/** 我方主动退款（含部分退）：钱已出账，需要红字凭证。 */
const PAYPAL_REFUNDED = new Set(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.PARTIALLY_REFUNDED"]);

/**
 * 事件类型 + 资金状态 → 归一判定。
 *
 * ⚠ 为什么 `COMPLETED` 还要再看 `resource.status`：事件会重放、会乱序，
 * 一个带 `status: "PENDING"` 的 COMPLETED 事件照旧入账就是「钱没到位先发货」。
 * 判不出来就归 `ignored`：事件照存但不敢动账。
 */
export function paypalEventOutcome(eventType: string, resourceStatus?: unknown): PaymentOutcome {
    const t = eventType.trim().toUpperCase();
    if (t === PAYPAL_CAPTURE_COMPLETED) return resourceStatus === "COMPLETED" ? "paid" : "ignored";
    if (PAYPAL_REVOKED.has(t)) return "revoked";
    if (PAYPAL_REFUNDED.has(t)) return "refunded";
    // PENDING / UNHELD / 争议类…：都是“钱还会动”的中间态，本轮不动账（宁可人工看事件表）。
    return "ignored";
}

/** 退款类事件的 `resource` 是**退款体**，不是收款体（回溯原收款要靠 refs）。 */
export function isPaypalRefundEvent(eventType: string): boolean {
    return PAYPAL_REFUNDED.has(eventType.trim().toUpperCase());
}

/**
 * 生产 Worker 上挂着沙箱凭据时，**假钱能把真订单标成已付**，而这一条我在代码里挡住不了：
 * 沙箱里那张单确实是我们建的、custom_id 与金额也都对得上，三道闸全部会过 ——
 * PayPal Orders v2 的响应里没有可靠的收款方标识可比，所以只剩「不许拿沙箱凭据改生产账」这一条。
 * 写成代码而不是约定：要拿沙箱改账就必须显式开 `PAYPAL_ALLOW_SANDBOX=1`（本地 .dev.vars 默认给，线上默认没有）。
 */
export function paypalSandboxBlocked(env: PaypalEnv, allowRaw: string | null | undefined): boolean {
    return env === "sandbox" && allowRaw?.trim() !== "1";
}

export interface PaypalEventRefs {
    /** 我方可读单号（create 时带进去的 custom_id）。 */
    orderNumber: string | null;
    /** 原收款交易号（capture id）= `payments.provider_ref`。 */
    captureId: string | null;
    /** PayPal 订单 id = `orders.paypal_order_id`（只能用来对账，不能当入账凭据）。 */
    paypalOrderId: string | null;
}

/**
 * 从事件 `resource` 里榨出三个关联标识。
 *
 * 为什么写得这么绕：PayPal 把同一份信息在不同事件里放在不同位置，而且**形状不统一** ——
 * capture 事件的 `supplementary_data.related_ids` 是对象（`{ "order_id": "…" }`，官方样本可证），
 * 退款事件的同一个字段是**数组**；`links[]` 里又各有一份。只读一条路就会在另一条路上丢关联，
 * 关联一丢，退款事件就落不到原那笔收款上（钱退了、账没冲）。
 *
 * 取不到就给 null，**不猜**：猜中的时候看不出来，猜错的时候是错账。
 */
export function extractPaypalEventRefs(resource: unknown, eventType: string): PaypalEventRefs {
    const res = asObj(resource) ?? {};
    const refundEvent = isPaypalRefundEvent(eventType);
    // 只有 capture 生命周期事件的 resource 才是**收款体**；CHECKOUT.* 的 resource 是订单体，
    // 它的 `id` 是 PayPal 订单号 —— 当成 capture 递出去，下游就会拿错的键去 AND，永远查不到那笔钱。
    const captureEvent = eventType.trim().startsWith("PAYMENT.CAPTURE.") && !refundEvent;

    // 候选 id 池：resource.id + related_ids（两种形状都收）；order_id 单独留着做订单关联
    const pool: string[] = [];
    const push = (v: unknown) => {
        if (typeof v === "string" && PP_ID_RE.test(v)) pool.push(v);
    };
    push(res.id);
    const sup = asObj(res.supplementary_data);
    const related = sup?.related_ids;
    let relatedOrderId: string | null = null;
    if (Array.isArray(related)) related.forEach(push);
    else if (related) {
        Object.values(asObj(related) ?? {}).forEach(push);
        const rawOrderId = asObj(related)?.["order_id"];
        if (typeof rawOrderId === "string" && PP_ID_RE.test(rawOrderId)) relatedOrderId = rawOrderId;
    }

    // links[]: rel → href 尾段（href 形如 …/v2/payments/captures/… 与 …/v2/checkout/orders/…）
    const linkHrefs: Record<string, string> = {};
    for (const item of Array.isArray(res.links) ? res.links : []) {
        const l = asObj(item);
        if (!l || typeof l.rel !== "string" || typeof l.href !== "string") continue;
        linkHrefs[l.rel] = l.href;
    }
    const tail = (rels: string[], re: RegExp): string | null => {
        for (const r of rels) {
            const href = linkHrefs[r];
            if (!href) continue;
            const m = re.exec(href);
            if (m && PP_ID_RE.test(m[1]!)) return m[1]!;
        }
        return null;
    };

    // 单号：capture 事件放在 resource 上，订单类事件放在 purchase_units[0] 上（两处都试）
    const units = Array.isArray(res.purchase_units) ? res.purchase_units : [];
    const firstUnit = asObj(units[0]);
    const orderNumber =
        typeof res.custom_id === "string" ? res.custom_id : typeof firstUnit?.custom_id === "string" ? firstUnit.custom_id : null;

    // capture id：退款体自己那个 id 是**退款号**，绝不能当 capture 用（否则冲账冲到另一笔上去）。
    // 退款事件的 `up` 指向 captures，capture 事件的 `up` 指向 orders —— 两个正则各自，互不误读。
    const captureId =
        tail(["capture"], /\/captures\/([^/?#]+)/) ??
        tail(["up", "related"], /\/captures\/([^/?#]+)/) ??
        pool.find((v) => v.startsWith("CAP-")) ??
        (captureEvent && typeof res.id === "string" && PP_ID_RE.test(res.id) ? res.id : null);

    const paypalOrderId = tail(["up", "order", "parent"], /\/orders\/([^/?#]+)/) ?? relatedOrderId;

    return { orderNumber, captureId, paypalOrderId };
}

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
    const refs = extractPaypalEventRefs(resource, eventType);
    const outcome = paypalEventOutcome(eventType, resource.status);

    return {
        providerEventId: eventId,
        type: eventType,
        providerRef: typeof resource.id === "string" ? resource.id : null,
        amountCents,
        // 两个口径必须一致：`succeeded` 就等 outcome==="paid"。留两个字段是为了读侧不用改，
        // 但如果它们能各自乱填，就是一个「一个说已付一个说没付」的隐形歧义源。
        succeeded: outcome === "paid",
        outcome,
        captureRef: refs.captureId,
        orderNumber: refs.orderNumber,
        orderId: null, // PayPal 不给我们内部 id，只给 custom_id
        raw: event,
    };
}

function asObj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
