import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeShippingProvider } from "./shippingProvider";

test("Fake createLabel 返回确定运单号", async () => {
    const p = new FakeShippingProvider();
    const label = await p.createLabel({ orderId: "order-12345678-90ab", carrier: "fake", toCountry: "US", weightG: 300 });
    assert.equal(label.provider, "fake");
    assert.ok(label.trackingNumber.startsWith("FAKE-"));
    assert.ok(label.labelUrl);
});

test("Fake track 对 FAKE 运单返回 in_transit", async () => {
    const p = new FakeShippingProvider();
    assert.equal((await p.track("FAKE-abc")).status, "in_transit");
    assert.equal((await p.track("other")).status, "unknown");
});
