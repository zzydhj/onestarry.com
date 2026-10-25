import { test } from "node:test";
import assert from "node:assert/strict";
import { FakePaymentProvider, splitReversal } from "./payments";

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

test("Fake verifyWebhook 解析归一化事件（接口现在收整个 header 集合，因为 PayPal 要五条）", async () => {
    const p = new FakePaymentProvider();
    const body = JSON.stringify({ providerEventId: "evt_1", type: "payment.succeeded", providerRef: "fake_pi_ord-1", amountCents: 26680, orderId: "ord-1" });
    const ev = await p.verifyWebhook(body, { get: () => null });
    assert.equal(ev.providerEventId, "evt_1");
    assert.equal(ev.succeeded, true);
    assert.equal(ev.amountCents, 26680);
    assert.equal(ev.orderId, "ord-1", "Fake 给内部 id；PayPal 则只给 orderNumber，两者不能混");
});

test("Fake verifyWebhook 缺字段应抛错", async () => {
    const p = new FakePaymentProvider();
    await assert.rejects(() => p.verifyWebhook(JSON.stringify({ type: "x" }), { get: () => null }), /FAKE_WEBHOOK_BAD_PAYLOAD/);
});

test("Fake refund 返回 succeeded", async () => {
    const p = new FakePaymentProvider();
    const r = await p.refund({ providerRef: "fake_pi_ord-1", amountCents: 1000 });
    assert.equal(r.status, "succeeded");
    assert.equal(r.providerRef, "fake_re_fake_pi_ord-1");
});

test("Fake 回调：outcome 缺省按 succeeded 推，显式给了以显式为准", async () => {
    const p = new FakePaymentProvider();
    const paid = await p.verifyWebhook(JSON.stringify({ providerEventId: "e1", type: "payment.succeeded", providerRef: "cap-1" }), { get: () => null });
    assert.equal(paid.outcome, "paid");
    assert.equal(paid.captureRef, "cap-1", "不单独给 captureRef 时要回退到 providerRef，否则冲账找不着原收款");

    const ignored = await p.verifyWebhook(JSON.stringify({ providerEventId: "e2", type: "payment.pending" }), { get: () => null });
    assert.equal(ignored.outcome, "ignored");

    const refunded = await p.verifyWebhook(
        JSON.stringify({ providerEventId: "e3", type: "payment.refunded", succeeded: true, outcome: "refunded", captureRef: "cap-1" }),
        { get: () => null },
    );
    assert.equal(refunded.outcome, "refunded", "反向事件必须能驱动冲账，否则本地与冒烟根本测不到它");
    assert.equal(refunded.succeeded, true, "succeeded 与 outcome 不一致时以显式 outcome 为准（调用方读 outcome）");
});

test("冲销分摊：全额原样，部分按占比，**和恒等于本次额**（借贷平的根）", () => {
    const base = { grossCents: 20500, taxCents: 4180, dutyCents: 2000 }; // 合计 26680

    assert.deepEqual(splitReversal(base, 26680, 26680), base, "全额冲销就应拿回原构成");
    assert.deepEqual(splitReversal(base, 26680, 13340), { grossCents: 10250, taxCents: 2090, dutyCents: 1000 });
    assert.deepEqual(splitReversal(base, 26680, 0), { grossCents: 0, taxCents: 0, dutyCents: 0 });
});

test("冲销分摊的尾差全部归最大项，绝不把 balance 丢掉", () => {
    // 1 分没得摊：三项地板除都是 0，余数必须有人接，否则借贷不平、退款事件永远落不下去
    assert.deepEqual(splitReversal({ grossCents: 20500, taxCents: 4180, dutyCents: 2000 }, 26680, 1), {
        grossCents: 1, taxCents: 0, dutyCents: 0,
    });
    const odd = splitReversal({ grossCents: 100, taxCents: 100, dutyCents: 0 }, 200, 101);
    assert.equal(odd.grossCents + odd.taxCents + odd.dutyCents, 101, "和必须恒等于本次冲销额");

    // 原收款无可摊构成（脏数据/全零）：全归货物项也不能报错
    assert.deepEqual(splitReversal({ grossCents: 0, taxCents: 0, dutyCents: 0 }, 0, 500), { grossCents: 500, taxCents: 0, dutyCents: 0 });

    assert.throws(() => splitReversal({ grossCents: 1, taxCents: 0, dutyCents: 0 }, 1, -1), /REVERSAL_BAD_AMOUNT/);
    assert.throws(() => splitReversal({ grossCents: 1.5, taxCents: 0, dutyCents: 0 }, 2, 1), /REVERSAL_BAD_BASE/);
});
