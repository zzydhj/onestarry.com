import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 流式边界与状态码的漂移守卫（审查 M2；对应 AGENTS 铁律「不给 force-dynamic 页面加 loading.tsx」）。
 *
 * 为什么必须是测试而不是注释：`loading.tsx` 会把所在段变成**流式边界** —— Next 先冲骨架，
 * HTTP 状态行在那一刻就定成 200，页面之后抛的 `redirect()` / `notFound()` 只能塞进 RSC payload
 * 由浏览器侧执行。于是「未登录跳登录」对外变成「200 + 骨架」：无 JS 客户端、爬虫、HEAD 探活
 * 拿到的全是软响应。线上实测（2026-10-29）：`/products/<slug>/review` 未登录返 **200**，
 * 而同仓没有 loading 边界的 `/order/<单号>` 返**真 404** —— 唯一差别就是祖先段有没有 `loading.tsx`。
 *
 * 判据为什么是「force-dynamic **且** 页内直接出现 `redirect()`/`notFound()`」，而不是平铺的
 * 「凡 force-dynamic 一律不许有 loading.tsx」：只有前者才是状态码会变软的**发作条件**。
 * `/cart`、`/checkout` 带骨架但不跳转 —— 删掉骨架会让转化路径上最贵的两页首屏变慢，
 * 违反本仓硬约束「速度不能变慢」；而一旦有人往这两页加跳转，本测试立刻变红。
 *
 * ⚠ 这是文本启发式，有明确边界：跳转藏在被 import 的 helper 里（如后台的 `requireAdmin`）扫不到。
 *   所以它守的是「页面自己写跳转」这一类；后台树的守卫覆盖另有 `admin-guard.test.ts`。
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const WEB_APP = `${REPO_ROOT}apps/web/app`;

type RouteFile = { route: string; dir: string; src: string };

/** 递归收集 page.tsx：既给出 URL 路由（忽略 `(组)` 段），也给出它所在的**绝对目录**（算祖先边界要用真实段名）。*/
function collectPages(dir: string, urlPrefix = ""): RouteFile[] {
    const out: RouteFile[] = [];
    for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (!statSync(full).isDirectory()) {
            if (name === "page.tsx") out.push({ route: urlPrefix === "" ? "/" : urlPrefix, dir, src: readFileSync(full, "utf8") });
            continue;
        }
        // 路由组 (xxx) 不出现在 URL 里，但**仍在目录树上**——loading.tsx 的影响跟着目录走，不跟着 URL 走。
        const nextUrl = name.startsWith("(") ? urlPrefix : `${urlPrefix}/${name}`;
        out.push(...collectPages(full, nextUrl));
    }
    return out;
}

/**
 * 该页的祖先段里是否存在 `loading.tsx`（含它自己所在段：`app/x/loading.tsx` 会包住 `app/x/page.tsx`）。
 * 纯函数、只吃「目录 → 有无 loading」的集合，方便用合成用例证明判据真的会抓人。
 */
function streamingBoundaries(rel: string, loadingDirs: Set<string>): string[] {
    // app 根上的 loading.tsx 包住每一页，所以先算它。
    const hit = loadingDirs.has("/") ? ["/"] : [];
    const segs = rel.split("/").filter(Boolean); // 相对 app 的段序列
    for (let i = segs.length; i >= 1; i--) {
        const ancestor = `/${segs.slice(0, i).join("/")}`;
        if (loadingDirs.has(ancestor)) hit.push(ancestor);
    }
    return hit;
}

const pages = existsSync(WEB_APP) ? collectPages(WEB_APP) : [];

function relDir(abs: string): string {
    return abs.slice(WEB_APP.length).replace(/\\/g, "/");
}

/** app 下所有含 loading.tsx 的目录（相对 app，形如 `/products/[slug]`）。 */
function loadingDirs(): Set<string> {
    const out = new Set<string>();
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const full = `${dir}/${name}`;
            if (!statSync(full).isDirectory()) {
                if (name === "loading.tsx") out.add(relDir(dir) === "" ? "/" : relDir(dir));
                continue;
            }
            walk(full);
        }
    };
    walk(WEB_APP);
    return out;
}

test("判据本身有效：合成用例必须抓出祖先边界（否则本守卫会静默常绿）", () => {
    const loading = new Set(["/products", "/products/[slug]", "/blog"]);
    assert.deepEqual(streamingBoundaries("/products/[slug]/review", loading), ["/products/[slug]", "/products"]);
    assert.deepEqual(streamingBoundaries("/account/orders", loading), [], "没有祖先边界时必须给空，不能瞎报");
    assert.deepEqual(streamingBoundaries("/blog/[slug]", loading), ["/blog"], "路由组/动态段的父段同样算边界");
    assert.deepEqual(streamingBoundaries("/cart", new Set(["/"])), ["/"], "app 根上的 loading.tsx 包住每一页，不得漏算");
});

test("force-dynamic 且会跳转的页面，祖先段不得存在 loading.tsx（会把跳转软成 HTTP 200）", { skip: pages.length === 0 }, () => {
    // 先确认扫描没空转：本站至少有 5 个 force-dynamic 页（真实数字 7 个左右）。
    const dynamic = pages.filter((p) => /force-dynamic/.test(p.src));
    assert.ok(dynamic.length >= 5, `只扫到 ${dynamic.length} 个 force-dynamic 页，先怀疑扫描逻辑而不是登记表`);

    const loading = loadingDirs();
    const offenders: string[] = [];
    for (const p of dynamic) {
        // `redirect(` / `notFound(` 才是会被流式外壳吃掉的「状态码动作」；纯渲染页不受影响。
        if (!/\b(?:redirect|notFound)\s*\(/.test(p.src)) continue;
        const boundaries = streamingBoundaries(relDir(p.dir), loading);
        if (boundaries.length) offenders.push(`${p.route}（祖先边界：${boundaries.join(", ")}）`);
    }
    assert.deepEqual(
        offenders,
        [],
        `这些页会把自己的跳转/404 软成 HTTP 200：${offenders.join("; ")}。` +
        `两条正解：① 把该页搬出带骨架的子树（如 /products/[slug]/review → /review/[slug]，不动 PDP 骨架）；` +
        `② 删掉它祖先段的 loading.tsx。选②前先确认这页的骨架不是转化率所需（见 docs/PERF.md）。`,
    );
});
