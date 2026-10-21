import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DECLARED_NEXT_MAJOR,
    compatDateStale,
    computeMaintenanceWindow,
    requiredWranglerMin,
    semverCompare,
    supportEndForMajor,
    windowStatusForDays,
    wranglerRequirementMet,
} from "./maintenance";

const NOON_2026_10_21 = new Date("2026-10-21T12:00:00Z");

test("支持截止日 = 发布日 + 2 年（UTC）", () => {
    assert.equal(supportEndForMajor(16)?.toISOString(), "2027-10-21T00:00:00.000Z");
    assert.equal(supportEndForMajor(15)?.toISOString(), "2026-10-21T00:00:00.000Z");
});

test("未登记的主版本 → null（OpenNext 会判为不支持，不是放行）", () => {
    assert.equal(supportEndForMajor(99), null);
    const w = computeMaintenanceWindow(99, NOON_2026_10_21);
    assert.equal(w.status, "unknown");
    assert.equal(w.supportEndDate, null);
    assert.equal(w.daysLeft, null);
});

test("Next 16 在 2026-10-21 当天还剩约一年，状态 ok", () => {
    const w = computeMaintenanceWindow(16, NOON_2026_10_21);
    assert.equal(w.supportEndDate, "2027-10-21");
    assert.equal(w.daysLeft, 364); // 365 天 - 12 小时，向下取整
    assert.equal(w.status, "ok");
});

test("Next 15 在 2026-10-21 12:00Z 已过期（截止日当天 00:00Z 过完）", () => {
    const w = computeMaintenanceWindow(15, NOON_2026_10_21);
    assert.equal(w.daysLeft, -1);
    assert.equal(w.status, "expired");
});

test("状态阈值：61 天 ok / 60 天 warn / 0 天 warn / 负数 expired", () => {
    assert.equal(windowStatusForDays(61), "ok");
    assert.equal(windowStatusForDays(60), "warn");
    assert.equal(windowStatusForDays(0), "warn");
    assert.equal(windowStatusForDays(-1), "expired");
});

test("semverCompare 只比前三段", () => {
    assert.equal(semverCompare("4.59.2", "4.59.2"), 0);
    assert.equal(semverCompare("4.151.3", "4.59.2"), 1);
    assert.equal(semverCompare("4.59.1", "4.59.2"), -1);
    assert.equal(semverCompare("16.4.2", "16.1.0"), 1);
});

test("Next ≥ 16.1 才要求 wrangler ≥ 4.59.2，且据此判定满足与否", () => {
    assert.equal(requiredWranglerMin("16.4.2"), "4.59.2");
    assert.equal(requiredWranglerMin("16.0.3"), null);
    assert.equal(requiredWranglerMin("15.5.28"), null);
    assert.equal(wranglerRequirementMet("16.4.2", "4.151.3"), true);
    assert.equal(wranglerRequirementMet("16.4.2", "4.59.1"), false);
    assert.equal(wranglerRequirementMet("15.5.28", "4.28.1"), true);
});

test("workerd compatibility_date 超过 6 个月算过时", () => {
    assert.equal(compatDateStale("2026-01-01", NOON_2026_10_21), true);
    assert.equal(compatDateStale("2026-06-01", NOON_2026_10_21), false);
    assert.equal(compatDateStale("不是日期", NOON_2026_10_21), false);
});

test("漂移护栏：DECLARED_NEXT_MAJOR 必须等于 apps/web 实际装的 Next 主版本", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../apps/web/package.json", import.meta.url), "utf8")) as {
        dependencies: Record<string, string>;
    };
    const declaredRange = pkg.dependencies["next"];
    assert.ok(declaredRange, "apps/web 应声明 next 依赖");
    const installedMajor = Number((declaredRange as string).replace(/[^\d.]/g, "").split(".")[0]);
    assert.equal(
        DECLARED_NEXT_MAJOR,
        installedMajor,
        `core/maintenance.ts 的 DECLARED_NEXT_MAJOR(${DECLARED_NEXT_MAJOR}) 与 apps/web 的 next(${declaredRange}) 不一致 —— 升级 Next 时请同步该常量与 NEXT_MAJOR_RELEASE_DATES`,
    );
});
