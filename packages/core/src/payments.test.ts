import { test } from "node:test";
import assert from "node:assert/strict";
import { FakePaymentProvider } from "./payments";

test("Fake createCheckout 返回确定 providerRef", async () => {
    const p = new FakePaymentProvider();
    const s = await p.createCheckout({
        orderId: "ord-1",
        amountCents: 26680,
        currency: "USD",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
    });
    assert.equal(s.provider, "fake");
    assert.equal(s.providerRef, "fake_pi_ord-1");
    assert.ok(s.clientSecret);
});

test("Fake verifyWebhook 解析归一化事件", async () => {
    const p = new FakePaymentProvider();
    const body = JSON.stringify({ providerEventId: "evt_1", type: "payment.succeeded", providerRef: "fake_pi_ord-1", amountCents: 26680 });
    const ev = await p.verifyWebhook(body, "sig-ignored");
    assert.equal(ev.providerEventId, "evt_1");
    assert.equal(ev.succeeded, true);
    assert.equal(ev.amountCents, 26680);
});

test("Fake verifyWebhook 缺字段应抛错", async () => {
    const p = new FakePaymentProvider();
    await assert.rejects(() => p.verifyWebhook(JSON.stringify({ type: "x" }), "sig"), /FAKE_WEBHOOK_BAD_PAYLOAD/);
});

test("Fake refund 返回 succeeded", async () => {
    const p = new FakePaymentProvider();
    const r = await p.refund({ providerRef: "fake_pi_ord-1", amountCents: 1000 });
    assert.equal(r.status, "succeeded");
    assert.equal(r.providerRef, "fake_re_fake_pi_ord-1");
});
