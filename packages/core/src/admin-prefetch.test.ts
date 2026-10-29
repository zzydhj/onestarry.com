import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 后台链接预取的漂移守卫（审查 L3；对应 AGENTS 铁律「后台导航一律 prefetch={false}，预取靠悬停」）。
 *
 * 为什么这条必须钉住：后台整棵树是 `force-dynamic`，Next 的默认行为是**链接一进视口就真预取**，
 * 而"真预取"对动态段等于"真渲染一次"（查会话 + 查权限 + 查数据）。实测一次后台加载因为侧栏入口
 * 被打出 36–45 个请求，把 Worker 与 Hyperdrive 连接池挤干、主文档 TTFB 拖到 2.8–4.9s（docs/PERF.md）。
 * 所以后台的链接只有两种合法形状：① `prefetch={false}` 的裸 `<Link>`（罕见：404/错误边界这类
 * 不指望用户点回去的页）；② `{@link PrefetchLink}`（正解：不进视口不取，悬停停满 150ms 才取那一个）。
 * 漏写 `prefetch={false}` 不会报错、不会变慢给开发看 —— 它只在生产上悄悄多打一圈请求，
 * 属于"没人看得见但人人受影响"的那类，所以做成测试。
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ADMIN_APP_DIR = `${REPO_ROOT}apps/admin`;
/** 它自己就是那道闸的实现，内部必须写真的 `<Link>`。 */
const ALLOWED_FILES = new Set([`${ADMIN_APP_DIR}/components/PrefetchLink.tsx`]);

/** 递归列出 .tsx / .ts（跳过 node_modules/.next 这类构建产物目录）。 */
function listSources(dir: string, skip = false): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (skip || name === "node_modules" || name === ".next" || name === "dist") {
            if (statSync(full).isDirectory()) out.push(...listSources(full, true));
            continue;
        }
        if (statSync(full).isDirectory()) {
            out.push(...listSources(full));
            continue;
        }
        if (/\.(tsx|ts)$/.test(name)) out.push(full);
    }
    return out;
}

/**
 * 取 `<Link` 之后直到该 JSX 标签结束的那一段（用于判有没有 `prefetch=`）。
 * 不能用「遇到第一个 > 就停」：属性里的箭头函数 `onClick={() => ...}` 也带 `>`，
 * 会把标签截断成半句、让检查变成假绿。所以跟踪 `{}` 深度与字符串状态，只在深度 0 的 `>` 收尾。
 */
function linkTag(src: string, from: number): string {
    let depth = 0;
    let quote = "";
    for (let i = from; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === quote) quote = "";
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) return src.slice(from, i + 1);
    }
    return src.slice(from); // 文件结尾没闭合：整段交给调用方判，宁可多报不漏报
}

const files = listSources(ADMIN_APP_DIR).filter((f) => !ALLOWED_FILES.has(f));

test("后台源码扫得到（防止本守卫因路径变动而空转）", () => {
    assert.ok(files.length >= 10, `只扫到 ${files.length} 个后台源文件，先怀疑扫描逻辑`);
    const withLink = files.filter((f) => readFileSync(f, "utf8").includes("<Link"));
    assert.ok(withLink.length >= 1, "一个 <Link> 都没扫到 = 守卫在空转");
});

test("<Link> 取到的标签必须完整（箭头函数属性不得把它截断成假绿）", () => {
    const sample = `<Link href="/" onClick={() => setX(false)} className="a">`;
    const tag = linkTag(`${sample}尾`, 0);
    assert.equal(tag, sample, "标签应在 > 处收尾且吃掉 () => 里的那个 >");
    assert.ok(!/prefetch\s*=/.test(tag), "这条样例本身就该判成漏写，不能被截断成看不见");
});

test("后台每个 <Link> 都必须显式 prefetch={false}（或改用 PrefetchLink）", () => {
    const offenders: string[] = [];
    for (const f of files) {
        const src = readFileSync(f, "utf8");
        let at = src.indexOf("<Link");
        while (at >= 0) {
            // `<Link` 后面必须紧跟空白或 >，否则命中的是 `<LinkThing` 这类组件名。
            const next = src[at + 5];
            if (next === undefined || /\s|>/.test(next)) {
                const tag = linkTag(src, at);
                // 只认“真用法”：带 href 才是链接。注释里的 `<Link>`（如 not-found 的头注）不带 href，
                // 不当 offender —— 宁可用一个窄判据避开假阳性，也不去做注释剥离（那会引入新的假阴）。
                // 已知代价：`<Link {...props}>` 这种纯 spread（本仓无此写法）扫不到，属于假阴。
                if (/href/.test(tag) && !/prefetch\s*=/.test(tag)) {
                    const line = src.slice(0, at).split("\n").length;
                    offenders.push(`${f.replace(ADMIN_APP_DIR, "apps/admin")}:${line}`);
                }
            }
            at = src.indexOf("<Link", at + 5);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `这些 <Link> 会进视口就真预取（后台是 force-dynamic，每次预取=一次完整服务端渲染）：${offenders.join(", ")}。` +
        `正解：换成 @/components/PrefetchLink（悬停满 150ms 才取、只取那一个）；` +
        `只有 404/错误边界这类不指望点回去的页才允许裸 <Link> + prefetch={false}。`,
    );
});
