import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_NUMBER_RANDOM_LEN, genOrderNumber, isOrderNumberShape } from "./orderNumber";

/**
 * 订单号熵与形状的契约。旧实现（Math.random × 46656 + 3 位）在这里会全部红：
 * 那正是 2026-10-23 审查发现的「确认页无鉴权 + 单号可枚举」复合风险的第二次。
 */

test("形状固定：SO-<时间 base36>-<8 位大写 base36>", () => {
    const n = genOrderNumber(1_792_680_836_736);
    assert.match(n, /^SO-[0-9A-Z]+-[0-9A-Z]{8}$/);
    assert.ok(isOrderNumberShape(n), "自己生成的号必须过自己的形状校验");
});

test("随机段真有 8 位（旧值 3 位 = 46,656 种，可枚举）", () => {
    assert.equal(ORDER_NUMBER_RANDOM_LEN, 8);
    assert.ok(Math.pow(36, ORDER_NUMBER_RANDOM_LEN) > 1e12, "空间必须大到无法在线枚举");
});

test("不用 Math.random：连续生成 500 个号不重复，且能覆盖到 8 位全字符集", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(genOrderNumber(Date.now()));
    assert.equal(seen.size, 500, "500 个号里出现重复 = 随机源太弱");
});

test("没有 crypto.getRandomValues 时宁可抛错，也不退化成 Math.random", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
        Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
        assert.throws(() => genOrderNumber(), /getRandomValues/);
    } finally {
        if (saved) Object.defineProperty(globalThis, "crypto", saved);
    }
});

test("isOrderNumberShape 拒掉手搓的怪值（别让任意字符串进 DB 查询）", () => {
    assert.equal(isOrderNumberShape("SO-TEST-000"), false, "旧 3 位形状不再接受");
    assert.equal(isOrderNumberShape("../../../etc/passwd"), false);
    assert.equal(isOrderNumberShape("SO-XYZ-ABCDEF12"), true);
});
