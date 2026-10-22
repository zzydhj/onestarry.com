import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    SITE_CRONS,
    SITE_ROUTES,
    formatRevalidate,
    routesRequiringStaticParams,
    worstPropagationSeconds,
} from "./site-status";

/**
 * 站点状态登记表的**漂移守卫**。
 *
 * 为什么要有这个文件：2026-10-22 那轮事故的制度性结论之一是「新增公开读页忘 `generateStaticParams`
 * 会静默退化成恒 STALE —— 不报错、内容还照对，只是每个访客多付一次跨洋渲染」（docs/PERF.md §7、架构方案 §22）。
 * 靠人记规矩 = 没有规矩。所以这里把登记表与真实源码逐条比对，让漂移变成测试失败。
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const WEB_APP = `${REPO_ROOT}apps/web/app`;
const JOBS_WRANGLER = `${REPO_ROOT}apps/jobs/wrangler.jsonc`;

/** 递归找所有 page.tsx（App Router 的路由文件），返回 Next 路径（根页为 "/"）。 */
function findPageRoutes(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (!statSync(full).isDirectory()) {
            if (name === "page.tsx") out.push(prefix === "" ? "/" : prefix);
            continue;
        }
        out.push(...findPageRoutes(full, `${prefix}/${name}`));
    }
    return out;
}

function readRepo(path: string): string {
    return readFileSync(`${REPO_ROOT}${path}`, "utf8");
}

/** Next 路径 → 登记表条目。 */
function entryFor(path: string) {
    return SITE_ROUTES.find((r) => r.path === path);
}

test("apps/web/app 下每个 page.tsx 都必须在 SITE_ROUTES 登记", { skip: !existsSync(WEB_APP) }, () => {
    const routes = [...new Set(findPageRoutes(WEB_APP))].sort();
    assert.ok(routes.length > 10, `扫到的路由数异常少（${routes.length}），先确认扫描逻辑再怀疑登记表`);
    const missing = routes.filter((p) => !entryFor(p));
    assert.deepEqual(
        missing,
        [],
        `新增/改名的前台路由没登记：${missing.join(", ")}。` +
        `公开读页登记时 kind 用 prerender-isr 且必须同时有 generateStaticParams（否则等于没修，见 docs/PERF.md §7）`,
    );
});

/** 取顶层函数体（本项目约定：顶层函数以列 0 的 `\n}` 结束）。找不到返回 null。 */
function fnBody(src: string, fnName: string): string | null {
    const at = src.indexOf(`function ${fnName}`);
    if (at < 0) return null;
    const open = src.indexOf("{", at);
    const close = src.indexOf("\n}", open);
    return open >= 0 && close > open ? src.slice(open + 1, close) : null;
}

test("声明为预渲染 ISR 的动态段路由，generateStaticParams 必须真去取数据（return [] = 没修）", { skip: !existsSync(WEB_APP) }, () => {
    const offenders: string[] = [];
    for (const r of routesRequiringStaticParams()) {
        const src = readRepo(r.file);
        if (!src.includes("generateStaticParams")) {
            offenders.push(`${r.path}（没有这个函数）`);
            continue;
        }
        // 真枚举一定 await 了查询，或至少 .map 了一个真列表。`return [];` 两者都没：
        // 它编译得过、不报错，但页会退回按需 ISR（恒 STALE、零缓存收益）——
        // 2026-10-22 类目页与品牌页就卡在这个形状上，冷进 2.3–4.3 秒。
        const body = fnBody(src, "generateStaticParams") ?? "";
        if (!/await|\.map\(/.test(body)) {
            offenders.push(`${r.path}（函数体是退化的 return []，等于没预渲染）`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `这些路由登记为整页 ISR 但没有真枚举 slug：${offenders.join(", ")}。` +
        `照 apps/web/app/brands/[slug]/page.tsx 用 listCurrentSlugs 补上。`,
    );
});

test("登记的 revalidate 秒数必须与源码一致（两边都得有或都得无）", { skip: !existsSync(WEB_APP) }, () => {
    const mismatched: string[] = [];
    for (const r of SITE_ROUTES) {
        if (!r.file.endsWith(".tsx") || !existsSync(`${REPO_ROOT}${r.file}`)) continue;
        const src = readRepo(r.file);
        const m = src.match(/export\s+const\s+revalidate\s*=\s*(\d+)/);
        const declared = m ? Number(m[1]) : null;
        if (declared !== r.revalidateSec) {
            mismatched.push(`${r.path}: 登记 ${formatRevalidate(r.revalidateSec)} / 源码 ${formatRevalidate(declared)}`);
        }
    }
    assert.deepEqual(mismatched, [], `登记表与源码的 revalidate 不一致：${mismatched.join("; ")}`);
});

test("私有与动态页不得声明边缘可缓存（no-store 是它们的保护）", () => {
    const wrong = SITE_ROUTES.filter((r) => (r.kind === "private" || r.kind === "dynamic") && r.edgeCacheable).map((r) => r.path);
    assert.deepEqual(wrong, [], `这些非缓存页被登记为边缘可存：${wrong.join(", ")} —— 购物车/订单被缓存住哪怕几秒都是事故`);
});

test("全站「改完可见」最坏上界仍是 60 秒（拉长要有意识地改这条断言）", () => {
    assert.equal(
        worstPropagationSeconds(),
        60,
        "公开读页的最大 revalidate 窗口变了。预渲染条目对 revalidatePath 免疫，" +
        "所以这个窗口就是运营改完到前台可见的真实上界 —— 要改请先读 docs/PERF.md §7",
    );
});

test("SITE_CRONS 的表达式必须与 apps/jobs/wrangler.jsonc 的 crons 一一对应", { skip: !existsSync(JOBS_WRANGLER) }, () => {
    const src = readRepo("apps/jobs/wrangler.jsonc");
    const block = src.match(/"crons"\s*:\s*\[([^\]]*)\]/);
    assert.ok(block, "wrangler.jsonc 里找不到 crons 块，先确认格式");
    const actual = (block?.[1]?.match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, "")).sort();
    assert.deepEqual([...SITE_CRONS].map((c) => c.cron).sort(), actual, "cron 登记表与实际触发器不一致（状态页会说谎）");
});
