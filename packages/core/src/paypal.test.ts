import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildPaypalOrderBody,
    extractPaypalCapture,
    extractPaypalEventRefs,
    isPaypalCertUrl,
    isPaypalOrderReusable,
    mapPaypalWebhookEvent,
    paypalAmountValue,
    paypalApiBase,
    paypalCentsFromValue,
    paypalEnv,
    paypalEventOutcome,
    paypalSdkRoot,
    paypalSdkUrl,
    paypalSdkUrls,
    paypalSdkAlternateRoot,
    paypalSandboxBlocked,
    paypalVerifySignatureBody,
} from "./paypal";

/**
 * PayPal Orders v2 / Webhooks 的纯逻辑契约。
 * 这一层值得逐条钉住的原因是：它们每一个错了都会变成**真钱**问题（金额错位、把别人的单标已付、验签被绕过）。
 */

test("环境判定：只有显式 live 才打生产，缺省一律 sandbox", () => {
    assert.equal(paypalEnv(undefined), "sandbox");
    assert.equal(paypalEnv(""), "sandbox");
    assert.equal(paypalEnv("LIVE "), "live");
    assert.equal(paypalEnv("garbage"), "sandbox", "乱值不许意外打到生产");
    assert.equal(paypalApiBase("live"), "https://api-m.paypal.com");
    assert.equal(paypalApiBase("sandbox"), "https://api-m.sandbox.paypal.com");
    assert.equal(paypalSdkRoot("sandbox"), "https://www.sandbox.paypal.com");
});

test("SDK 候选地址：主选 = 当前环境 host，备选 = 另一个 host（不赌哪个才是官方推荐的）", () => {
    const input = { clientId: "A" + "b".repeat(24), currency: "USD", env: "sandbox" as const };
    const urls = paypalSdkUrls(input);
    assert.equal(urls.length, 2);
    assert.ok(urls[0]!.startsWith("https://www.sandbox.paypal.com/sdk/js?"), "沙箱先试沙箱 host");
    assert.ok(urls[1]!.startsWith("https://www.paypal.com/sdk/js?"), "失败后退到统一 host");
    assert.equal(paypalSdkAlternateRoot("sandbox"), "https://www.paypal.com");
    assert.equal(paypalSdkAlternateRoot("live"), "https://www.sandbox.paypal.com");
    assert.throws(() => paypalSdkUrls({ ...input, clientId: "short" }), /形状不符/, "候选地址也不能绕过 client-id 形状门控");
});

test("金额：分 → 字符串两位小数；JPY 这类 0 位小数币种不除 100", () => {
    assert.equal(paypalAmountValue(26680, "usd"), "266.80");
    assert.equal(paypalAmountValue(5, "USD"), "0.05");
    assert.equal(paypalAmountValue(1000, "JPY"), "1000", "JPY 是 0 位小数：写成 10.00 就是收错钱");
    assert.throws(() => paypalAmountValue(-1, "USD"));
    assert.throws(() => paypalAmountValue(1.5, "USD"), "分必须是整数");
});

test("金额反向解析严格：形状不合一律 null，不做 Number() 兜底", () => {
    assert.equal(paypalCentsFromValue("266.80", "USD"), 26680);
    assert.equal(paypalCentsFromValue("266.8", "USD"), null, "一位小数不收");
    assert.equal(paypalCentsFromValue("1,234.00", "USD"), null);
    assert.equal(paypalCentsFromValue("266.80", "JPY"), null, "0 位小数币种给小数不收");
    assert.equal(paypalCentsFromValue("1000", "JPY"), 1000);
    assert.equal(paypalCentsFromValue(undefined, "USD"), null);
    assert.equal(paypalCentsFromValue("-1.00", "USD"), null);
});

test("SDK URL 带 client-id/currency/intent；client-id 形状不合直接抛", () => {
    const url = paypalSdkUrl({ clientId: "A" + "b".repeat(24), currency: "usd", env: "sandbox", locale: "en_US" });
    assert.ok(url.startsWith("https://www.sandbox.paypal.com/sdk/js?"));
    assert.ok(url.includes("intent=capture"));
    assert.ok(url.includes("currency=USD"));
    assert.ok(url.includes("locale=en_US"));
    assert.throws(() => paypalSdkUrl({ clientId: "abc", currency: "USD", env: "live" }), /形状不符/);
    assert.throws(
        () => paypalSdkUrl({ clientId: "AKIA\" onload=alert(1)", currency: "USD", env: "live" }),
        /形状不符/,
        "误把 secret 或带引号的值填进来要在拼 URL 前就炸，而不是静默拼出一个坏 script",
    );
});

test("建单体：custom_id 与 invoice_id 都带我方单号，地址走我方（NO_SHIPPING）", () => {
    const body = buildPaypalOrderBody({ orderNumber: "SO-MVKG-ABCD1234", amountCents: 26680, currency: "USD" });
    const unit = (body.purchase_units as Record<string, unknown>[])[0]!;
    assert.equal(body.intent, "CAPTURE");
    assert.equal(unit.custom_id, "SO-MVKG-ABCD1234");
    assert.equal(unit.invoice_id, "SO-MVKG-ABCD1234");
    assert.deepEqual(unit.amount, { currency_code: "USD", value: "266.80" });
    assert.equal((body.application_context as Record<string, string>).shipping_preference, "NO_SHIPPING");
});

test("capture 解析：正常体取全字段；缺 captures / 结构不对一律 null", () => {
    const ok = {
        id: "5O190127TN364715T",
        status: "COMPLETED",
        purchase_units: [
            {
                custom_id: "SO-MVKG-ABCD1234",
                payments: { captures: [{ id: "7X123456A1234567B", status: "COMPLETED", amount: { currency_code: "USD", value: "266.80" } }] },
            },
        ],
    };
    assert.deepEqual(extractPaypalCapture(ok), {
        paypalOrderId: "5O190127TN364715T",
        captureId: "7X123456A1234567B",
        status: "COMPLETED",
        amountCents: 26680,
        currency: "USD",
        orderNumber: "SO-MVKG-ABCD1234",
    });

    // 旧写法在这里会静默返回 null（把数组当对象判掉了）——这条就是那个 bug 的回归测试。
    assert.ok(extractPaypalCapture(ok), "captures 是数组，必须能解析");
    assert.equal(extractPaypalCapture({ id: "ABC123456", purchase_units: [] }), null);
    assert.equal(extractPaypalCapture({ id: "ABC123456", purchase_units: [{ payments: {} }] }), null);
    assert.equal(extractPaypalCapture({ id: "a", purchase_units: [{ payments: { captures: [{ id: "x" }] } }] }), null, "id 太短不收");
});

test("可复用状态：CREATED/APPROVED/PAYER_ACTION_REQUIRED 可继续，COMPLETED 不许再建", () => {
    assert.equal(isPaypalOrderReusable("CREATED"), true);
    assert.equal(isPaypalOrderReusable("APPROVED"), true);
    assert.equal(isPaypalOrderReusable("COMPLETED"), false);
    assert.equal(isPaypalOrderReusable(undefined), false);
});

test("cert_url 白名单：必须 https 且确实是 *.paypal.com 的子域", () => {
    assert.equal(isPaypalCertUrl("https://api-m.paypal.com/v1/notifications/certs/CERT-360caa42"), true);
    assert.equal(isPaypalCertUrl("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1"), true);
    assert.equal(isPaypalCertUrl("http://api-m.paypal.com/cert"), false, "明文不收");
    assert.equal(isPaypalCertUrl("https://paypal.com.evil.tld/cert"), false, "后缀伪装必须拒");
    assert.equal(isPaypalCertUrl("https://evil.tld/?x=https://api-m.paypal.com/"), false);
    assert.equal(isPaypalCertUrl(null), false);
});

test("验签请求体带整个 webhook_event（官方更新后少这一项就永远验不过）", () => {
    const body = paypalVerifySignatureBody({
        authAlgo: "SHA256withRSA",
        certUrl: "https://api-m.paypal.com/v1/notifications/certs/CERT-1",
        transmissionId: "tid",
        transmissionSig: "sig",
        transmissionTime: "2026-10-23T00:00:00Z",
        webhookId: "WH-123",
        event: { id: "WH-123-456", event_type: "PAYMENT.CAPTURE.COMPLETED" },
    });
    assert.deepEqual(body.webhook_event, { id: "WH-123-456", event_type: "PAYMENT.CAPTURE.COMPLETED" }, "整个事件必须送进去，否则 CRC32 对不上");
    assert.deepEqual(Object.keys(body).sort(), [
        "auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time", "webhook_event", "webhook_id",
    ]);
});

test("回调映射：capture 完成才算成功，单号来自 custom_id", () => {
    const e = mapPaypalWebhookEvent({
        id: "WH-8PT597110X687430LKGECATA",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource_type: "capture",
        resource: { id: "7X123456A1234567B", status: "COMPLETED", custom_id: "SO-MVKG-ABCD1234", amount: { currency_code: "USD", value: "266.80" } },
    });
    assert.equal(e.succeeded, true);
    assert.equal(e.providerRef, "7X123456A1234567B");
    assert.equal(e.orderNumber, "SO-MVKG-ABCD1234");
    assert.equal(e.orderId, null);
    assert.equal(e.amountCents, 26680);
});

test("回调映射：未完成/被拒的事件 succeeded=false 且归到 revoked", () => {
    const denied = mapPaypalWebhookEvent({
        id: "WH-1", event_type: "PAYMENT.CAPTURE.DENIED",
        resource: { id: "826413372K501814R", status: "DECLINED", custom_id: "SO-A", amount: { currency_code: "USD", value: "12.00" } },
    });
    assert.equal(denied.succeeded, false);
    assert.equal(denied.outcome, "revoked", "被拒必须归到 revoked：不处理就是「钱没到手但系统以为已付」");
    assert.equal(denied.captureRef, "826413372K501814R", "capture 事件的 resource.id 就是收款号");
    assert.equal(denied.amountCents, 1200);

    const approved = mapPaypalWebhookEvent({
        id: "WH-2", event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "5O190127TN364715T", status: "APPROVED", purchase_units: [{ custom_id: "SO-B" }] },
    });
    assert.equal(approved.succeeded, false, "APPROVED 只代表买家批准了，钱还没扣");
    assert.equal(approved.outcome, "ignored");
    assert.equal(approved.orderNumber, "SO-B", "订单类事件的 custom_id 在 purchase_units 上");
    assert.equal(approved.captureRef, null, "订单体的 id 是 PayPal 订单号，当 capture 递下去会永远查不到那笔钱");
});

test("事件分类：钱的正反方向靠事件名判，名字错一个字母就静默归入 ignored", () => {
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.COMPLETED", "COMPLETED"), "paid");
    // COMPLETED 事件配非 COMPLETED 状态（重放/乱序）不能入账
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.COMPLETED", "PENDING"), "ignored");
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.DENIED", "DECLINED"), "revoked");
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.REVERSED", "REVERSED"), "revoked");
    assert.equal(paypalEventOutcome("CHECKOUT.PAYMENT-APPROVAL.REVERSED", undefined), "revoked");
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.REFUNDED", "COMPLETED"), "refunded");
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.PARTIALLY_REFUNDED", "COMPLETED"), "refunded");
    // PENDING / UNHELD / 争议类：钱还会动，本轮不动账
    assert.equal(paypalEventOutcome("PAYMENT.CAPTURE.PENDING", "PENDING"), "ignored");
    assert.equal(paypalEventOutcome("CUSTOMER.DISPUTE.CREATED", undefined), "ignored");
    assert.equal(paypalEventOutcome("  payment.capture.denied ", undefined), "revoked", "大小写与空格不能影响判定");
});

test("关联提取：官方 DENIED 样本（related_ids 是对象 + links.up 指 orders）全部对上", () => {
    const refs = extractPaypalEventRefs(
        {
            id: "826413372K501814R",
            status: "DECLINED",
            custom_id: "MERCHANT_CUSTOM_ID",
            supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
            links: [
                { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/826413372K501814R" },
                { rel: "refund", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/826413372K501814R/refund" },
                { rel: "up", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T" },
            ],
        },
        "PAYMENT.CAPTURE.DENIED",
    );
    assert.deepEqual(refs, { orderNumber: "MERCHANT_CUSTOM_ID", captureId: "826413372K501814R", paypalOrderId: "5O190127TN364715T" });
});

test("关联提取：退款事件的 resource 是退款体，靠 links.up 回溯原 capture（冲账就靠它）", () => {
    const refs = extractPaypalEventRefs(
        {
            id: "1H730916DD7496419",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "30.00" },
            links: [{ rel: "up", href: "https://api-m.paypal.com/v2/payments/captures/7X123456A1234567B" }],
        },
        "PAYMENT.CAPTURE.REFUNDED",
    );
    assert.equal(refs.captureId, "7X123456A1234567B", "拿不到 custom_id 时，capture id 就是唯一回溯依据");
    assert.equal(refs.orderNumber, null, "没给就不造：给个错单号比给 null 贵得多");
    assert.equal(refs.paypalOrderId, null, "up 指向 captures，不能被 /orders/ 正则误读");
});

test("关联提取：related_ids 是数组形状时也能拿到（只读对象会在退款路上丢关联）", () => {
    const refs = extractPaypalEventRefs(
        { id: "REF-9XY16098CD512345W", supplementary_data: { related_ids: ["CAP-99984968BB243503C", "REF-9XY16098CD512345W"] } },
        "PAYMENT.CAPTURE.REFUNDED",
    );
    assert.equal(refs.captureId, "CAP-99984968BB243503C");
});

test("沙箱闸：缺省禁止拿沙箱凭据动账，live 永远放行", () => {
    assert.equal(paypalSandboxBlocked("sandbox", undefined), true, "没显式开就不许动账（默认必须是‘不改账’）");
    assert.equal(paypalSandboxBlocked("sandbox", ""), true);
    assert.equal(paypalSandboxBlocked("sandbox", "0"), true, "写 0 不等于开");
    assert.equal(paypalSandboxBlocked("sandbox", " 1 "), false, "显式开了就要生效（带空格是常见的 env 写法）");
    assert.equal(paypalSandboxBlocked("live", undefined), false, "生产凭据不该被这个闸误伤");
});

test("回调信封不合就抛（没有 id / event_type 的东西不进账本）", () => {
    assert.throws(() => mapPaypalWebhookEvent({ event_type: "PAYMENT.CAPTURE.COMPLETED" }), /BAD_ENVELOPE/);
    assert.throws(() => mapPaypalWebhookEvent(null), /BAD_ENVELOPE/);
    assert.throws(() => mapPaypalWebhookEvent("字符串"), /BAD_ENVELOPE/);
});
