import { test } from "node:test";
import assert from "node:assert/strict";
import {
    classifyIsrSamples,
    isrReportAgeMinutes,
    isrVerdictNeedsAction,
    parseSMaxAge,
    worstIsrVerdict,
    type IsrSample,
} from "./isr";

/** 造样本的小工具：只写关心的字段，其余按线上实测的默认形状补。 */
function sample(over: Partial<IsrSample> & { offsetMs: number }): IsrSample {
    return { status: 200, cache: "STALE", sMaxAge: 2, ...over };
}

test("parseSMaxAge：认得 HIT 的倒计时、STALE 的 2、以及没有该指令的情况", () => {
    assert.equal(parseSMaxAge("s-maxage=47, stale-while-revalidate=2592000"), 47);
    assert.equal(parseSMaxAge("public, max-age=0, s-maxage=2"), 2);
    assert.equal(parseSMaxAge("private, no-cache, no-store, max-age=0, must-revalidate"), null);
    assert.equal(parseSMaxAge(null), null);
});

test("复查全 HIT = 正常（这就是 2026-10-22 之前 / 与 /products 的健康形状）", () => {
    const f = classifyIsrSamples("/", [
        sample({ offsetMs: 0, cache: "STALE", sMaxAge: 2 }), // 触发刷新的那次，结论不参与判定
        sample({ offsetMs: 14_000, cache: "HIT", sMaxAge: 47 }),
        sample({ offsetMs: 26_000, cache: "HIT", sMaxAge: 35 }),
    ]);
    assert.equal(f.verdict, "ok");
});

test("复查里 HIT 与 STALE 交替 = 命中不稳定（本次 PDP 故障被漏诊前的真实形状）", () => {
    const f = classifyIsrSamples("/products/linen-tote", [
        sample({ offsetMs: 0, cache: "STALE", sMaxAge: null }),
        sample({ offsetMs: 13_000, cache: "HIT", sMaxAge: 51 }),
        sample({ offsetMs: 24_000, cache: "STALE", sMaxAge: null }),
        sample({ offsetMs: 36_000, cache: "HIT", sMaxAge: 43 }),
    ]);
    assert.equal(f.verdict, "oscillating");
});

test("复查从不 HIT = 写回断了：STALE/MISS 都算「有 ISR 头但没命中」", () => {
    const f = classifyIsrSamples("/products/ceramic-mug", [
        sample({ offsetMs: 0, cache: "MISS", sMaxAge: 60 }),
        sample({ offsetMs: 13_000, cache: "STALE", sMaxAge: null }),
        sample({ offsetMs: 26_000, cache: "STALE", sMaxAge: null }),
    ]);
    assert.equal(f.verdict, "never_hits");
});

test("复查全无 x-nextjs-cache 头 = 该路由已经不是 ISR 页（与「写回断了」必须分开报）", () => {
    const f = classifyIsrSamples("/products/steel-bottle", [
        sample({ offsetMs: 0, cache: null, sMaxAge: null }),
        sample({ offsetMs: 13_000, cache: null, sMaxAge: null }),
    ]);
    assert.equal(f.verdict, "not_isr");
});

test("5xx 与请求失败优先判 error（结论本身不可信，不该报「缓存坏了」）", () => {
    assert.equal(
        classifyIsrSamples("/x", [sample({ offsetMs: 0 }), sample({ offsetMs: 9_000, status: 500 })]).verdict,
        "error",
    );
    assert.equal(
        classifyIsrSamples("/x", [sample({ offsetMs: 0, status: 0, cache: null }), sample({ offsetMs: 9_000 })]).verdict,
        "error",
    );
});

test("只有一个样本 = unknown（没有复查就没法判，宁可不报）", () => {
    assert.equal(classifyIsrSamples("/x", [sample({ offsetMs: 0 })]).verdict, "unknown");
});

test("worst：多个路由取最坏的那个，运维只看一眼结论", () => {
    const findings = [
        classifyIsrSamples("/", [sample({ offsetMs: 0 }), sample({ offsetMs: 14_000, cache: "HIT", sMaxAge: 47 })]),
        classifyIsrSamples("/products/linen-tote", [
            sample({ offsetMs: 0 }),
            sample({ offsetMs: 14_000, cache: "STALE", sMaxAge: null }),
        ]),
    ];
    assert.equal(worstIsrVerdict(findings), "never_hits");
    assert.equal(worstIsrVerdict([]), "unknown");
});

test("unknown 不打扰人，其余非 ok 都要亮条", () => {
    assert.equal(isrVerdictNeedsAction("ok"), false);
    assert.equal(isrVerdictNeedsAction("unknown"), false);
    assert.equal(isrVerdictNeedsAction("oscillating"), true);
    assert.equal(isrVerdictNeedsAction("never_hits"), true);
    assert.equal(isrVerdictNeedsAction("not_isr"), true);
    assert.equal(isrVerdictNeedsAction("error"), true);
});

test("报告时效：坏时钟/空值都退化成 null 而不是 NaN", () => {
    assert.equal(isrReportAgeMinutes("2026-10-22T02:00:00.000Z", Date.parse("2026-10-22T02:07:30.000Z")), 8);
    assert.equal(isrReportAgeMinutes(undefined, 1), null);
    assert.equal(isrReportAgeMinutes("not-a-date", 1), null);
});
