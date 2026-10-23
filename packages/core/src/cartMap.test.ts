import { test } from "node:test";
import assert from "node:assert/strict";
import { CART_MAX_LINES, CART_MAX_QTY, parseCartCookie, sanitizeCartMap } from "./cartMap";

/**
 * 购物车净化的契约：cookie 是**用户可手改**的（httpOnly 只挡脚本），
 * 所以任何参与金额乘法的数字都必须在这里被拦住。旧实现是 JSON.parse 后原样返回。
 */

const V = "0f6c1f1a-2f0e-7a3b-9c1d-2e3f4a5b6c7d";
const V2 = "0f6c1f1a-2f0e-7a3b-9c1d-2e3f4a5b6c7e";

test("正常购物车原样通过", () => {
    assert.deepEqual(sanitizeCartMap({ [V]: 2, [V2]: 1 }).items, [
        { variantId: V, quantity: 2 },
        { variantId: V2, quantity: 1 },
    ]);
});

test("负数 / 0 / 小数 / 超大数 / 字符串数字全拒，且计入 dropped", () => {
    for (const bad of [-3, 0, 1.5, 1e15, CART_MAX_QTY + 1, "2", NaN, Infinity, null, true, {}]) {
        const r = sanitizeCartMap({ [V]: bad });
        assert.deepEqual(r.items, [], `值 ${String(bad)} 不该被接受`);
        assert.equal(r.dropped, 1, `值 ${String(bad)} 要报告被丢弃，不能静默`);
    }
});

test("key 必须是 UUID 形状（防塞 __proto__ 或任意字符串进 SQL）", () => {
    assert.deepEqual(sanitizeCartMap({ "not-a-uuid": 2, ["__proto__"]: 2 }) .items, []);
    assert.equal(sanitizeCartMap({ [V]: 2 }).items.length, 1);
});

test("行数有上限（防 10 万行把结账那条 SQL 撑爆）", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < CART_MAX_LINES + 20; i++) many[`0f6c1f1a-2f0e-7a3b-9c1d-2e3f4a5b6c${String(i).padStart(2, "0")}`] = 1;
    const r = sanitizeCartMap(many);
    assert.equal(r.items.length, CART_MAX_LINES);
    assert.equal(r.dropped, 20);
});

test("整个 cookie 不是对象 / 不是合法 JSON → 空清单不抛错", () => {
    assert.deepEqual(sanitizeCartMap([1, 2]).items, []);
    assert.deepEqual(sanitizeCartMap("hello").items, []);
    assert.deepEqual(parseCartCookie("{坏 JSON").items, []);
    assert.deepEqual(parseCartCookie(undefined), { items: [], dropped: 0 });
});

test("parseCartCookie 走的是同一套规则（读车与下单必须同口径）", () => {
    const r = parseCartCookie(JSON.stringify({ [V]: -1 }));
    assert.deepEqual(r.items, []);
    assert.equal(r.dropped, 1);
});
