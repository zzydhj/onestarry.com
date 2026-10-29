import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 后台鉴权漂移守卫（审查 L-8）。
 *
 * 为什么要这个文件：后台根 layout 是**故意**用 `readAdminSession()` 软取会话的（只为按权限渲染导航，
 * 不跳转），真正的强制在各页 `requirePermission` / `requireAdmin` 与 Server Action 里。
 * 于是「新增一个页面忘记写守卫」的后果不是报错，而是**该页对所有公网访客渲染后台数据**，
 * 而 Server Action 照样拒绝 —— 表现为「能看不能改」的静默泄露，是最难被撞见的那类缺陷。
 * 靠人记规矩 = 没有规矩，所以把这条不变量做成测试。
 *
 * 为什么**不是** middleware.ts（评估过、否决，别再提）：
 *   ① 在 middleware 里真验会话必须连库 → 每个后台请求多一条跨洋连接，正是 docs/PERF.md §2 否决过的
 *      「绕过 better-auth 直查会话表」同类代价（连接池就是本站的瓶颈）；
 *   ② 不连库就只能复刻 better-auth 的私有 cookie 签名方案 → 官方未承诺的稳定格式，判错即认证绕过；
 *   ③ 只判 cookie **存在与否** 则是第二道、且更弱的闸：给了「有 middleware 兜底」的假安全感，
 *      还违反「一条事实只允许有一个真源」（页面仍必须自带守卫，因为它才做权限判定）。
 *   真正的强制只能在页面/动作里 —— 这里做的是让「漏写」在提交时就变红，而不是再加一层假闸。
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ADMIN_APP = `${REPO_ROOT}apps/admin/app`;

/** 刻意公开的后台路由：登录页本身必须让未登录的人访问得到。 */
const PUBLIC_ROUTES = new Set<string>(["/signin"]);

/** 显式强制守卫的调用形态（共享 helper，见 apps/admin/lib/auth.ts）。 */
const GUARD_CALL = /(?:requirePermission|requireAdmin)\s*\(/;
/** 守卫必须来自这个唯一入口，不许就地手写会话/cookie 判断。 */
const GUARD_IMPORT = /from\s+"@\/lib\/auth"/;

/** 递归找所有 page.tsx（App Router 的路由文件），返回 Next 路径（根页为 "/"）。 */
function findPageRoutes(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (!statSync(full).isDirectory()) {
            if (name === "page.tsx") out.push(prefix === "" ? "/" : prefix);
            continue;
        }
        // 忽略 (组) 这类路由组段名：它们不出现在 URL 里。
        const next = name.startsWith("(") ? prefix : `${prefix}/${name}`;
        out.push(...findPageRoutes(full, next));
    }
    return out;
}

function readRouteSource(route: string): string {
    // "/" 对应 app/page.tsx；其余把路由段还原成目录路径（动态段 [x] 原样是目录名）。
    const rel = route === "/" ? "page.tsx" : `${route.slice(1)}/page.tsx`;
    return readFileSync(`${ADMIN_APP}/${rel}`, "utf8");
}

const routes = findPageRoutes(ADMIN_APP);

test("后台路由树能被扫到（防止本测试因路径变动而空转）", () => {
    assert.ok(routes.includes("/"), `没扫到后台根页，路径变了？实际：${routes.join(", ")}`);
    assert.ok(routes.length >= 15, `后台页面数异常偏少（${routes.length}），本测试可能已失效`);
});

test("每个后台页面都必须显式调用鉴权守卫（漏一页 = 静默数据泄露）", () => {
    const naked = routes
        .filter((r) => !PUBLIC_ROUTES.has(r))
        .filter((r) => !GUARD_CALL.test(readRouteSource(r)));
    assert.deepEqual(
        naked,
        [],
        `这些后台页面没有任何 requirePermission/requireAdmin 调用，公网可直接读到后台数据：${naked.join(", ")}。` +
            `正确写法：import { requirePermission } from "@/lib/auth"; 并在取数据前 await requirePermission(PERMISSIONS.xxx)。`,
    );
});

test("守卫必须走唯一入口 @/lib/auth（不许各页自造判断）", () => {
    const offenders = routes
        .filter((r) => !PUBLIC_ROUTES.has(r))
        .filter((r) => GUARD_CALL.test(readRouteSource(r)))
        .filter((r) => !GUARD_IMPORT.test(readRouteSource(r)));
    assert.deepEqual(
        offenders,
        [],
        `这些页面调用了守卫却没有从 "@/lib/auth" 导入（第二真源）：${offenders.join(", ")}`,
    );
});

test("公开白名单不得悄悄长大：名单里的页必须真的是登录入口", () => {
    for (const r of PUBLIC_ROUTES) {
        assert.ok(routes.includes(r), `白名单里的 ${r} 已不存在，请从 PUBLIC_ROUTES 删除`);
    }
});
