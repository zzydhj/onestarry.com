import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSellability, type SellabilityInput } from "./sellability";

/** 全可售基线：各用例只覆盖需要变更的那一项。 */
const ok: SellabilityInput = {
    productStatus: "active",
    marketActive: true,
    availability: { hasAllowlist: false, allowed: false, denied: false },
    prohibited: false,
    hasPrice: true,
    shipsTo: true,
    availabilityPolicy: "in_stock_only",
    availableQty: 5,
};

test("全条件满足 → 可售", () => {
    assert.deepEqual(computeSellability(ok), { sellable: true, reasons: [] });
});

test("草稿商品 → product_not_active", () => {
    const r = computeSellability({ ...ok, productStatus: "draft" });
    assert.equal(r.sellable, false);
    assert.ok(r.reasons.includes("product_not_active"));
});

test("黑名单命中优先于白名单", () => {
    const r = computeSellability({
        ...ok,
        availability: { hasAllowlist: true, allowed: true, denied: true },
    });
    assert.ok(r.reasons.includes("availability_denied"));
    assert.ok(!r.reasons.includes("not_in_allowlist")); // 命中 deny 时不再评估 allow 缺失
});

test("白名单模式未命中 → not_in_allowlist", () => {
    const r = computeSellability({
        ...ok,
        availability: { hasAllowlist: true, allowed: false, denied: false },
    });
    assert.ok(r.reasons.includes("not_in_allowlist"));
});

test("无价格 + 不配送 同时上报多个原因", () => {
    const r = computeSellability({ ...ok, hasPrice: false, shipsTo: false });
    assert.equal(r.sellable, false);
    assert.deepEqual(r.reasons.sort(), ["no_price", "no_shipping"].sort());
});

test("in_stock_only 且 0 库存 → out_of_stock", () => {
    const r = computeSellability({ ...ok, availableQty: 0 });
    assert.ok(r.reasons.includes("out_of_stock"));
});

test("backorder 允许 0 库存下单 → 可售", () => {
    const r = computeSellability({ ...ok, availabilityPolicy: "backorder", availableQty: 0 });
    assert.equal(r.sellable, true);
});

test("品类禁售 → category_prohibited", () => {
    const r = computeSellability({ ...ok, prohibited: true });
    assert.ok(r.reasons.includes("category_prohibited"));
});
