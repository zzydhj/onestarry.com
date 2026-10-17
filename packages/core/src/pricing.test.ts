import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLandedPrice, type LandedPriceInput } from "./pricing";

const euDdp: LandedPriceInput = {
    goodsValueCents: 10000,
    shippingCents: 500,
    taxRate: 0.19,
    dutyRate: 0.1,
    pricingMode: "fixed_gross",
    dutyPresentation: "included_in_price",
    thresholdCents: 15000,
    overThresholdPolicy: "block",
};

test("EU DDP 全包价：货10000 运500 税19% 关10% → allIn 13685", () => {
    const r = computeLandedPrice(euDdp);
    assert.equal(r.blocked, false);
    assert.equal(r.dutyCents, 1000);
    assert.equal(r.taxCents, 2185); // round((10000+500+1000)*0.19)
    assert.equal(r.allInCents, 13685);
    assert.equal(r.displayedPriceCents, 13685); // fixed_gross + included_in_price → 展示即全包
});

test("超每票阈值且 policy=block → 拦截", () => {
    const r = computeLandedPrice({ ...euDdp, goodsValueCents: 20000 });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, "over_threshold");
    assert.equal(r.allInCents, 0);
});

test("switch_to_ddp 超阈值不拦截，照常计 DDP", () => {
    const r = computeLandedPrice({ ...euDdp, goodsValueCents: 20000, overThresholdPolicy: "switch_to_ddp" });
    assert.equal(r.blocked, false);
    assert.equal(r.dutyCents, 2000);
    assert.equal(r.allInCents, 26775);
});

test("net_plus_tax + separate_line → 展示价仅货+运，税/关结账另计", () => {
    const r = computeLandedPrice({
        ...euDdp,
        pricingMode: "net_plus_tax",
        dutyPresentation: "separate_line",
    });
    assert.equal(r.allInCents, 13685);
    assert.equal(r.displayedPriceCents, 10500); // 10000 + 500
});

test("无阈值市场（US）：高货值也不拦截，税率为 0 时不计税", () => {
    const r = computeLandedPrice({
        goodsValueCents: 99999,
        shippingCents: 0,
        taxRate: 0,
        dutyRate: 0,
        pricingMode: "net_plus_tax",
        dutyPresentation: "separate_line",
        thresholdCents: null,
        overThresholdPolicy: "block",
    });
    assert.equal(r.blocked, false);
    assert.equal(r.allInCents, 99999);
});
