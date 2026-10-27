// scripts/dead-scan.mjs —— 死代码体检：从"真入口"出发沿 import 图走一遍，走不到的才报出来。
//
// 为什么要写成脚本而不是一次人肉清理：2026-10-27 那次我先用 grep 猜"谁没被引用"，
// 报了 144 个孤儿，里面包含 core/paypal.ts、AdminSideNav.tsx 这种明显在用的文件 ——
// 因为 grep 不认 barrel 再导出（`export * from "./paypal"` + 消费方 `from "@onestarry/core"`）。
// 换成真正的图遍历，结论反过来了：251 个源文件里 234 可达，"孤儿"全是测试文件与入口误判。
// **拿假阳性清单去删代码就是事故**，所以这一步必须可重跑、可核对。
//
// 用法：pnpm scan:dead        （退出码：有未解释的孤儿时非 0，方便挂 CI）
//
// 三条口径：
// 1. 「没有调用方」≠「没用」。本仓是**模板**，刻意保留了一些当前 demo 未接的能力
//    （如 shippingProvider / legalBody / retention / csv）。这类文件登记在
//    docs/IMPLEMENTATION.md §9「未接线清单」，**不许凭本脚本结论删除**。
// 2. 测试文件（*.test.ts）由 `tsx --test` 的 glob 直接跑，永远不会被 import ⇒ 视为入口。
// 3. 解析不出的 import 会单独列出：那说明有别名/动态引用我没覆盖，先修脚本再信结论。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";

const ROOT = process.cwd();
const PKGS = ["core", "db", "ui", "auth", "config", "jobs"];

// Next.js 约定式入口：这些永远不会被 import，但都是真入口
const NEXT_ENTRY = /^(page|layout|route|loading|error|global-error|not-found|template|default|icon|apple-icon|sitemap|robots|manifest|opengraph-image|twitter-image)$/;
const CONFIG_ENTRY = /(next\.config|open-next\.config|drizzle\.config|tailwind\.preset|postcss\.config)\./;
// 一次性/运维脚本：由 package.json scripts 或 wrangler 调起
const SCRIPTISH = /(^|\/)scripts\/|(^|\/)(seed|smoke|perf)[-.]|\.smoke\.ts$|\.test\.ts$/;

const files = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
// 分析范围只看 .ts/.tsx，但**入口发现要看全量跟踪文件**：wrangler.jsonc / package.json / *.mjs
// 都不在 ts 名单里 —— 只拿 ts 名单去筛它们会空转，Worker 入口与构建脚本就会被误报成孤儿（踩过）。
const allTracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
const tracked = new Set(allTracked);

/** 把相对/别名 specifier 解析成仓内被跟踪的文件；解析不出返回 null，外部包返回 EXTERNAL。 */
function asFile(absPath) {
    // .mjs/.js 也要试：next.config.ts 里 `import "../../scripts/build-stamp.mjs"` 就是构建期真依赖，
    // 只当 .ts 会把工具脚本误报成孤儿。
    for (const e of ["", ".ts", ".tsx", ".d.ts", ".mjs", ".js", ".cjs", "/index.ts", "/index.tsx"]) {
        const rel = relative(ROOT, absPath + e).replace(/\\/g, "/");
        if (tracked.has(rel)) return rel;
    }
    return null;
}

const exportsMaps = {};
for (const p of PKGS) {
    const pj = join(ROOT, "packages", p, "package.json");
    if (existsSync(pj)) exportsMaps[p] = JSON.parse(readFileSync(pj, "utf8")).exports ?? null;
}

function resolvePackage(spec) {
    const m = spec.match(/^@onestarry\/([^/]+)(?:\/(.*))?$/);
    if (!m) return null;
    const [, pkg, sub] = m;
    const dir = join(ROOT, "packages", pkg);
    const ex = exportsMaps[pkg];
    if (ex) {
        let v = ex[sub ? `./${sub}` : "."];
        if (!v && sub) {
            for (const k of Object.keys(ex)) {
                if (!k.includes("*")) continue;
                const re = new RegExp("^" + k.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)") + "$");
                const mm = `./${sub}`.match(re);
                if (mm) { v = ex[k].replace(/\*/g, mm[1]); break; }
            }
        }
        if (v && typeof v === "object") v = v.import ?? v.types ?? v.default;
        if (typeof v === "string") return asFile(join(dir, v));
    }
    return sub ? asFile(join(dir, "src", sub)) : asFile(join(dir, "src", "index"));
}

function resolveSpec(spec, fromFile) {
    if (spec.startsWith(".")) return asFile(resolve(dirname(join(ROOT, fromFile)), spec));
    if (spec.startsWith("@/")) {
        const app = fromFile.match(/^(apps\/[^/]+)\//);
        return app ? asFile(join(ROOT, app[1], spec.slice(2))) : null;
    }
    if (spec.startsWith("@onestarry/")) return resolvePackage(spec);
    return "EXTERNAL";
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(f) {
    const src = readFileSync(join(ROOT, f), "utf8");
    const out = [];
    let m;
    while ((m = IMPORT_RE.exec(src))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
}

/** 读 jsonc（剥 // 行注释与尾逗号）取 wrangler 的 main。
 *  ⚠ 剔注释必须排除字符串里的 `//`：本仓 wrangler.jsonc 里有 `postgresql://…` 连接串，
 *  无条件剔会把 JSON 砍坏（实测报 Bad control character）⇒ parse 静默失败 ⇒ Worker 入口被误报成孤儿。
 *  只剥“行首或紧跟空白”的 //，`://` 那种就在引号里，不动。 */
function jsonc(path) {
    const raw = readFileSync(path, "utf8").replace(/(^|\s)\/\/[^\n]*/g, "$1").replace(/,(\s*[}\]])/g, "$1");
    try { return JSON.parse(raw); } catch { return null; }
}

// 工具配置类入口：由**外部程序**读（不是被 import），当入口处理。
// neon.ts = Neon CLI 的分支策略配置（`neon checkout` 用），TS 编译与运行时都不碰它。
const TOOL_CONFIG = [/^neon\.ts$/];

const roots = new Set();
for (const f of files) {
    const base = f.split("/").pop().replace(/\.(ts|tsx)$/, "");
    if (NEXT_ENTRY.test(base) || CONFIG_ENTRY.test(f) || SCRIPTISH.test(f) || /(^|\/)(middleware|instrumentation)\.ts$/.test(f) || TOOL_CONFIG.some((re) => re.test(f))) roots.add(f);
}
// package.json 的 scripts 里指向的文件（seed/smoke/perf/迁移…）
for (const f of allTracked.filter((x) => x.endsWith("package.json"))) {
    let o;
    try { o = JSON.parse(readFileSync(join(ROOT, f), "utf8")); } catch { continue; }
    for (const s of Object.values(o.scripts ?? {})) {
        for (const mm of String(s).matchAll(/([A-Za-z0-9_@./-]+\.(?:ts|tsx|mjs))/g)) {
            const cand = mm[1].replace(/^\.\//, "");
            const hit = asFile(resolve(dirname(join(ROOT, f)), cand)) ?? asFile(resolve(ROOT, cand));
            if (hit) roots.add(hit);
        }
    }
}
// wrangler 的 main（Worker 入口，全仓唯一“不被 import 的真入口”）
for (const f of allTracked.filter((x) => x.endsWith("wrangler.jsonc") || x.endsWith("wrangler.toml"))) {
    const o = jsonc(join(ROOT, f));
    if (o?.main) {
        const hit = asFile(resolve(dirname(join(ROOT, f)), o.main));
        if (hit) roots.add(hit);
        // 指向构建产物（.open-next/worker.js 之类）是正常的：那不是源文件，不参与可达性分析。
        else if (/\.(ts|tsx)$/.test(o.main)) console.log(`  ! ${f} 的 main=${o.main} 没解析到（这得查）`);
    }
}

const seen = new Set(roots);
const unresolved = [];
const queue = [...roots];
while (queue.length) {
    const cur = queue.shift();
    let specs;
    try { specs = importsOf(cur); } catch { continue; }
    for (const s of specs) {
        const r = resolveSpec(s, cur);
        if (!r) unresolved.push({ from: cur, spec: s });
        else if (r !== "EXTERNAL" && !seen.has(r)) { seen.add(r); queue.push(r); }
    }
}

const orphans = files.filter((f) => !seen.has(f) && !f.endsWith(".d.ts"));

console.log(`源文件 ${files.length}   入口 ${roots.size}   可达 ${seen.size}   走不到 ${orphans.length}   未解析 import ${unresolved.length}`);
if (unresolved.length) {
    console.log("\n[先修这里] 解析不出的 import（说明有别名或动态引用没覆盖，此时下面的结论不可信）：");
    for (const u of [...new Map(unresolved.map((x) => [x.spec, x])).values()]) console.log(`   ${u.spec}   <- ${u.from}`);
}
if (orphans.length) {
    console.log("\n[再判这里] 没有任何 import 指向的文件 —— 注意：模板里「无调用方」往往是**未接线的既定能力**，");
    console.log("           必须逐条对 docs/IMPLEMENTATION.md §9 之后再决定，不许批量删。");
    for (const o of orphans) console.log(`   ${String(readFileSync(join(ROOT, o), "utf8").split("\n").length).padStart(5)} 行  ${o}`);
}
process.exit(orphans.length || unresolved.length ? 1 : 0);
