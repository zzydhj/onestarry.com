import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatMoney } from "./money";

/**
 * 金额展示的唯一入口（审查 L7）。
 * 这些断言钉的是**口径**（小数位/千分位/符号位置/大小写宽容/非法码不炸），
 * 不是"顺手打印一下"：九份副本合并成一份之后，任何形状变化都必须是有人改了这里，而不是漂移。
 */

test("常规金额：按币种两位小数 + 千分位", () => {
    assert.equal(formatMoney(26680, "USD"), "$266.80");
    assert.equal(formatMoney(123456789, "USD"), "$1,234,567.89");
    assert.equal(formatMoney(0, "USD"), "$0.00");
    assert.equal(formatMoney(100000, "eur"), "€1,000.00", "币种码按 Intl 的规定大小写宽容（库里存 usd 也要能显示）");
});

test("负额照常表达（调用方自己决定要不要另外写负号）", () => {
    assert.equal(formatMoney(-500, "USD"), "-$5.00");
});

test("非法币种码退成「数字 + 原始码」，绝不把页面打成 500", () => {
    // 先证明这条分支真的是活的：同样的输入直接喂给 Intl 就是会抛（实测 2026-10-29）。
    // `markets.currency` 是无约束 text，运营填 "US Dollars" 这类值不该让整个商品页挂掉。
    assert.throws(
        () => new Intl.NumberFormat("en-US", { style: "currency", currency: "US Dollars" }).format(1),
        RangeError,
        "对照前提：非法码在原生 Intl 里必须抛，否则下面那条断言就是在测空气",
    );
    assert.equal(formatMoney(123450, "US Dollars"), "1,234.50 US Dollars");
    assert.equal(formatMoney(123450, "XY"), "1,234.50 XY");
    assert.equal(formatMoney(100, ""), "1.00 ?", "空码不显示成孤立的一个数字，得留个占位让人看出配置有问题");
});

/* ---------------- 单一真源守卫（审查 L7 的真正目的） ---------------- */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** 递归列 apps/<sub> 下的源码（不进 node_modules 与构建产物目录）。 */
function listAppSources(sub: string): string[] {
    const dir = `${REPO_ROOT}apps/${sub}`;
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (statSync(full).isDirectory()) {
            if (name === "node_modules" || name === ".next" || name === ".open-next" || name === "dist") continue;
            out.push(...listAppSources(`${sub}/${name}`));
            continue;
        }
        if (/\.(tsx|ts)$/.test(name)) out.push(full);
    }
    return out;
}

test("金额排版只能住在 core：apps 里不得自己写 Intl 货币格式", () => {
    // 这一条就是 L7 的本身：原先 9 个页面各抄一份逐字相同的 `new Intl.NumberFormat(..., { style: "currency" })`，
    // 下次改口径（本地化/小数位/取整规则）必然只改到一份，剩下的会安静地显示旧格式且不报错。
    const scanned = ["web", "admin", "jobs"].flatMap((app) => listAppSources(app));
    // 反空转：目录挂错时本守卫会“一个也没扫到”而假绿，所以先确认扫到了足够多的文件。
    assert.ok(scanned.length >= 30, `只扫到 ${scanned.length} 个 apps 源码文件，先怀疑扫描逻辑而不是结论`);
    const offenders = scanned
        .filter((f) => /style:\s*"currency"/.test(readFileSync(f, "utf8")))
        .map((f) => f.replace(REPO_ROOT, ""));
    assert.deepEqual(
        offenders,
        [],
        `这些文件自己拼了货币格式：${offenders.join(", ")}。金额展示请走 @onestarry/core 的 formatMoney（单一真源）。`,
    );
});
