import { test } from "node:test";
import assert from "node:assert/strict";
import { INVALIDATE_MAX_PATHS, planInvalidatePaths, secretsMatch } from "./invalidate";

test("收下本站真实存在的前台路由族", () => {
    const { accepted, rejected } = planInvalidatePaths([
        "/",
        "/products",
        "/products/ceramic-mug",
        "/categories",
        "/categories/home",
        "/brands",
        "/brands/onestarry",
        "/blog",
        "/blog/shipping-guide",
        "/legal/privacy",
        "/about", // CMS 落地页（app/[slug]）
    ]);
    assert.equal(rejected.length, 0);
    assert.equal(accepted.length, 11);
});

test("归一化：补前导斜杠、丢多余尾斜杠、去重（同一页不该失效两次）", () => {
    const { accepted, rejected } = planInvalidatePaths(["products/ceramic-mug", "/products/ceramic-mug/", "/products/ceramic-mug", "  /  "]);
    assert.equal(rejected.length, 0);
    assert.deepEqual(accepted, ["/products/ceramic-mug", "/"]);
});

test("拒掉多段/带扩展名的路径 —— 这个端点不能变成任意路径的重渲染开关", () => {
    for (const bad of ["/admin/products", "/api/health", "/account/orders", "/products/ceramic-mug/review", "/_next/static/x.js", "/../env", "/cart/x"]) {
        const { accepted, rejected } = planInvalidatePaths([bad]);
        assert.deepEqual(accepted, [], `${bad} 不该被收下`);
        assert.equal(rejected.length, 1, `${bad} 必须留下拒绝原因，不能静默丢`);
    }
});

test("根级单段形状全收是有意为之（CMS 页无法与具名段区分），最坏只是白重渲染一次", () => {
    // /cart /checkout 这类动态页本来就不进 ISR，revalidatePath 打上去没效果；
    // 调用方是拿密钥的自家 admin，加上单次条数上限，放大器关掉。
    const { accepted } = planInvalidatePaths(["/cart", "/checkout", "/signin", "/about-us"]);
    assert.deepEqual(accepted, ["/cart", "/checkout", "/signin", "/about-us"]);
});

test("拒掉形状不符的输入（query / fragment / 大写 slug / 空串 / 非字符串）", () => {
    const { accepted, rejected } = planInvalidatePaths(["/products/ceramic-mug?market=us", "/products/ceramic-mug#x", "/products/Ceramic-Mug", "", "   ", 42, null, { p: "/products" }]);
    assert.deepEqual(accepted, []);
    assert.equal(rejected.length, 8);
});

test("paths 不是数组 → 整体拒，并给出原因", () => {
    for (const bad of ["/products", { paths: "/products" }, undefined, 42]) {
        const { accepted, rejected } = planInvalidatePaths(bad);
        assert.deepEqual(accepted, []);
        assert.equal(rejected.length, 1);
    }
});

test("条数有上限，超出的部分被拒而不是慢慢渲染", () => {
    const many = Array.from({ length: INVALIDATE_MAX_PATHS + 5 }, (_, i) => `/products/p-${i}`);
    const { accepted, rejected } = planInvalidatePaths(many);
    assert.equal(accepted.length, INVALIDATE_MAX_PATHS);
    assert.equal(rejected.length, 5);
    assert.match(rejected[0]!.reason, /上限/);
});

test("secretsMatch：没配密钥一律拒（fail closed），且不做前缀短路", () => {
    assert.equal(secretsMatch("abc", undefined), false);
    assert.equal(secretsMatch(undefined, "abc"), false);
    assert.equal(secretsMatch("", ""), false);
    assert.equal(secretsMatch("abc", "abc"), true);
    assert.equal(secretsMatch("abc", "abd"), false);
    assert.equal(secretsMatch("abc", "ab"), false);
    assert.equal(secretsMatch("abcd", "abc"), false);
    // 长度不同但共享前缀：仍必须判不等（长度差要参与比较，不能只比公共前缀）
    assert.equal(secretsMatch("a".repeat(64), "a".repeat(63)), false);
});
