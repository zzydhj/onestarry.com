"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { makeAuthClient } from "@onestarry/auth/client";
import { SITE_NAME } from "@onestarry/core";
import type { MaintenanceAlert, PermissionKey } from "@onestarry/core";
import { PrefetchLink } from "./PrefetchLink";
import { NAV_GROUPS, navItemVisible } from "@/lib/nav";

const authClient = makeAuthClient();

/** 折叠状态存这儿；用「组 id」而不是 href 作键，改名不会让所有人的偏好失效。 */
const STORE_KEY = "admin.nav.collapsed";

/** 单条入口是否“包含”当前路径：完全相等，或是它的子路（详情页 `/products/<id>` 归到 `/products`）。 */
function matches(pathname: string, href: string): boolean {
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 当前页高亮：**最长匹配（最具体）的那个入口才亮，只允许一个**。
 *
 * 为什么不能单纯用前缀匹配：`/products/new`、`/products/import` 在路径上是 `/products` 的子路，
 * 但在导航里是**兄弟入口** —— 前缀规则会造成“跳到批量导入，商品管理还亮着”（用户 2026-10-25 报的）。
 * 而详情页 `/products/<id>` 又**确实**应该算在“商品管理”下（它没有自己的入口）。
 * 一条规则同时满足两者：先收集所有命中的入口，只亮名字最长（最具体）的那一个。
 */
function isActive(pathname: string, href: string, candidates: string[]): boolean {
    let best = "";
    for (const h of candidates) {
        if (h.length > best.length && matches(pathname, h)) best = h;
    }
    return best !== "" && best === href;
}

/**
 * 后台左侧导航（ERP 式：分组 + 可折叠 + 二级入口）。
 *
 * 三条硬约束，改这里前先读：
 * 1. **一律 `prefetch={false}`，预取改由 {@link PrefetchLink} 在悬停时做**：后台整棵树是 force-dynamic，
 *    Next 的“进视口就预取”会把所有入口各真渲染一遍（每个 = 查会话 + 查权限 + 查数据），
 *    实测一次加载打出 36–45 个请求，把 Worker 与数据库连接池挤干、主文档 TTFB 拖到 2.8–4.9s。
 *    ⚠ 本处原先写着“悬停仍会预取，体感不变差”—— 2026-10-25 实测**不成立**：App Router 没有内置
 *    悬停预取（悬停 2.5 秒不发任何请求），于是每次点击都要现场等一次渲染（2.4–3.4s）。
 *    现在由 components/PrefetchLink.tsx 真的补上：停留满 150ms 才取、只取鼠标停住的那一个。
 * 2. 隐藏入口只是体验优化，真正的强制在各页 `requirePermission` 与 Server Action 里。
 * 3. 折叠偏好写 localStorage，**首屏必须与服务端渲染一致**（默认全展开，挂载后再应用偏好）——
 *    否则 React 会因 hydration 不匹配整棵导航重挂，出现"点一下闪一下"。
 */
export function AdminSideNav({ permissions = [], alert = null }: { permissions?: PermissionKey[]; alert?: MaintenanceAlert | null }) {
    const pathname = usePathname();
    const router = useRouter();
    const [collapsed, setCollapsed] = useState<string[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) setCollapsed(JSON.parse(raw) as string[]);
        } catch {
            /* 偏好读不出来就用默认值，不值得打扰 */
        }
    }, []);

    function toggleGroup(id: string) {
        setCollapsed((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            try {
                localStorage.setItem(STORE_KEY, JSON.stringify(next));
            } catch {
                /* 隐私模式/配额满：折叠不生效而已 */
            }
            return next;
        });
    }

    const allowed = useMemo(() => new Set<string>(permissions), [permissions]);
    const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => navItemVisible(i, allowed)) })).filter((g) => g.items.length > 0);
    // 参与“最长匹配”的只算**看得见**的入口：无权限的入口不该把高亮抢过去。
    const visibleHrefs = groups.flatMap((g) => g.items.map((i) => i.href));

    async function logout() {
        await authClient.signOut();
        router.push("/signin");
        router.refresh();
    }

    if (pathname === "/signin") return null;

    const nav = (
        <nav className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-4">
            <div className="px-2 pb-3">
                <PrefetchLink href="/" className="block text-base font-semibold tracking-tight text-brand">
                    {SITE_NAME}
                </PrefetchLink>
                <span className="text-xs text-muted">管理后台</span>
            </div>

            {groups.map((g) => {
                const open = !collapsed.includes(g.id);
                const hasActive = g.items.some((i) => isActive(pathname, i.href, visibleHrefs));
                return (
                    <div key={g.id} className="mb-1.5">
                        <button
                            type="button"
                            onClick={() => toggleGroup(g.id)}
                            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] transition hover:bg-slate-50 ${hasActive ? "text-slate-700" : "text-slate-400 hover:text-slate-600"}`}
                            aria-expanded={open}
                        >
                            <span className="flex items-center gap-1.5">
                                {g.label}
                                {/* 折叠时组内还有当前页：不给个标记就彻底找不到自己在哪 */}
                                {hasActive && !open ? <span aria-label="该分组内有当前页" className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                            </span>
                            <span aria-hidden className={`text-xs text-slate-400 transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
                                ›
                            </span>
                        </button>
                        {open ? (
                            /* 竖向导引 + 缩进：展开与折叠的差别必须一眼看出来，不能只差一个箭头旋转 */
                            <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-slate-300 pl-2">
                                {g.items.map((i) => {
                                    const active = isActive(pathname, i.href, visibleHrefs);
                                    return (
                                        <li key={i.href}>
                                            <PrefetchLink
                                                href={i.href}
                                                onClick={() => setDrawerOpen(false)}
                                                className={`block rounded-md px-2 py-1.5 text-[13px] leading-snug transition ${active ? "bg-accent/10 font-medium text-accent" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                                            >
                                                {i.label}
                                                {i.badge ? <span className="ml-1.5 text-[10px] text-muted">{i.badge}</span> : null}
                                                {i.href === "/" && alert ? (
                                                    <span
                                                        aria-label="有维护事项待处理"
                                                        className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${alert.level === "expired" ? "bg-red-500" : "bg-amber-500"}`}
                                                    />
                                                ) : null}
                                            </PrefetchLink>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : null}
                    </div>
                );
            })}

            {alert ? (
                <PrefetchLink
                    href="/status"
                    className={`mt-2 rounded-lg border px-2 py-1.5 text-xs font-medium leading-snug ${alert.level === "expired" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                >
                    {alert.text}
                </PrefetchLink>
            ) : null}

            <div className="mt-auto pt-4">
                <button onClick={logout} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted transition hover:bg-slate-50 hover:text-red-600">
                    登出
                </button>
            </div>
        </nav>
    );

    return (
        <>
            {/* 桌面：固定左栏 */}
            <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-white md:block">{nav}</aside>

            {/* 移动：顶栏 + 抽屉 */}
            <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden">
                <PrefetchLink href="/" className="font-semibold tracking-tight text-brand">
                    {SITE_NAME} · 后台
                </PrefetchLink>
                <button
                    type="button"
                    onClick={() => setDrawerOpen((v) => !v)}
                    aria-expanded={drawerOpen}
                    aria-label="打开导航"
                    className="rounded-lg border border-line px-2.5 py-1 text-sm text-muted"
                >
                    菜单
                </button>
            </header>
            {drawerOpen ? (
                <div className="fixed inset-0 z-50 md:hidden">
                    <button type="button" aria-label="关闭导航" className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} />
                    <div className="absolute inset-y-0 left-0 w-64 border-r border-line bg-white shadow-xl">{nav}</div>
                </div>
            ) : null}
        </>
    );
}
