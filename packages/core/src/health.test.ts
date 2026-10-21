import { test } from "node:test";
import assert from "node:assert/strict";
import { healthPayload } from "./health";

test("健康载荷带全字段（放量时要能一眼看出线上是哪个提交）", () => {
    const h = healthPayload("onestarry-admin", { gitSha: "b529ab0", buildTime: "2026-10-21T15:00:00.000Z" }, 1700000000000);
    assert.deepEqual(h, {
        ok: true,
        service: "onestarry-admin",
        gitSha: "b529ab0",
        buildTime: "2026-10-21T15:00:00.000Z",
        ts: 1700000000000,
    });
});

test("构建期没注入时退化为 unknown，而不是崩或漏字段", () => {
    const h = healthPayload("onestarry-web", {}, 1);
    assert.equal(h.gitSha, "unknown");
    assert.equal(h.buildTime, "unknown");
});

test("stamp 传 undefined 也安全（process.env 读不到时就是 undefined）", () => {
    const h = healthPayload("onestarry-web", { gitSha: undefined, buildTime: undefined }, 2);
    assert.equal(h.gitSha, "unknown");
    assert.equal(h.ok, true);
});
