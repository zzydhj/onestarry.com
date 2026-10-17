import { test } from "node:test";
import assert from "node:assert/strict";
import { computeShipping, type RateCard } from "./shipping";

const tierCard: RateCard = {
    currency: "USD",
    mode: "weight_tier",
    tiers: [
        { upToG: 200, priceCents: 300 },
        { upToG: 500, priceCents: 450 },
    ],
    overKgCents: 600,
};

test("weight_tier 命中档位", () => {
    const r = computeShipping(tierCard, 300);
    assert.equal(r.chargeableWeightG, 300);
    assert.equal(r.shippingCents, 450);
    assert.equal(r.free, false);
});

test("超出最重档按 overKgCents/公斤（向上取整）", () => {
    const r = computeShipping(tierCard, 1200);
    // 1200-500=700g → ceil=1kg → 450 + 600
    assert.equal(r.shippingCents, 1050);
});

test("体积重超过实际重时按体积重计费", () => {
    const r = computeShipping(tierCard, 100, { l: 20, w: 15, h: 10 });
    // 体积重 = 20*15*10/5000*1000 = 600g
    assert.equal(r.chargeableWeightG, 600);
    // 600-500=100g → ceil=1kg → 450+600
    assert.equal(r.shippingCents, 1050);
});

test("per_kg + 挂号费", () => {
    const r = computeShipping({ currency: "USD", mode: "per_kg", perKgCents: 700, registrationCents: 150 }, 1500);
    // ceil(1.5)=2kg → 1400 + 150
    assert.equal(r.shippingCents, 1550);
});

test("flat + 挂号费", () => {
    const r = computeShipping({ currency: "USD", mode: "flat", flatCents: 500, registrationCents: 100 }, 999);
    assert.equal(r.shippingCents, 600);
});

test("满额免运费", () => {
    const r = computeShipping({ ...tierCard, freeOverCents: 9900 }, 1200, undefined, 10000);
    assert.equal(r.free, true);
    assert.equal(r.shippingCents, 0);
});
