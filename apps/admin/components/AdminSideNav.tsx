"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { makeAuthClient } from "@onestarry/auth/client";
import { SITE_NAME } from "@onestarry/core";
import type { MaintenanceAlert, PermissionKey } from "@onestarry/core";
import { PrefetchLink } from "./PrefetchLink";

const authClient = makeAuthClient();

/** 一个入口 + 它所需权限点（无 perm = 任意后台账号可见）。与页面/动作的 requirePermission 一一对应。 */
interface NavItem {
    href: string;
    label: string;
    perm?: PermissionKey;
    /** 徽标文案（如"新"）——只放稳定信息，实时状态放页面里。 */
    badge?: string;
}

/** 分组 = ERP 后台的二级结构。组的可见性由"组内是否还有可见项"决定，不单独配权限。 */
interface NavGroup {
    id: string;
    label: string;
    items: NavItem[];
}

const GROUPS: NavGroup[] = [
    {
        id: "home",
        label: "总览",
        items: [
            { href: "/", label: "概览" },
            { href: "/status", label: "站点状态", perm: "config:write", badge: "缓存 · 版本 · 定时" },
        ],
    },
    {
        id: "catalog",
        label: "商品",
        items: [
            { href: "/products", label: "商品管理", perm: "product:write" },
            { href: "/products/new", label: "新建商品", perm: "product:write" },
            { href: "/products/import", label: "批量导入", perm: "product:write" },
            { href: "/reviews", label: "评论审核", perm: "product:write" },
        ],
    },
    {
        id: "trade",
        label: "交易",
        items: [{ href: "/orders", label: "订单管理", perm: "order:write" }],
    },
    {
        id: "taxonomy",
        label: "目录结构",
        items: [
            { href: "/categories", label: "类目", perm: "category:write" },
            { href: "/brands", label: "品牌", perm: "category:write" },
            { href: "/attributes", label: "属性定义", perm: "config:write" },
        ],
    },
    {
        id: "content",
        label: "内容与合规",
        items: [
            { href: "/content", label: "内容 CMS", perm: "seo:write" },
            { href: "/legal", label: "法律文档", perm: "seo:write" },
        ],
    },
    {
        id: "system",
        label: "配置与团队",
        items: [
            { href: "/markets", label: "市场", perm: "market:write" },
            { href: "/team", label: "团队权限", perm: "role:manage" },
        ],
    },
];

/** 折叠状态存这儿；用「组 id」而不是 href 作键，改名不会让所有人的偏好失效。 */
const STORE_KEY = "admin.nav.collapsed";

function isActive(pathname: string, href: string): boolean {
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
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
    const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || allowed.has(i.perm)) })).filter((g) => g.items.length > 0);

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
                const hasActive = g.items.some((i) => isActive(pathname, i.href));
                return (
                    <div key={g.id} className="mb-1">
                        <button
                            type="button"
                            onClick={() => toggleGroup(g.id)}
                            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition hover:bg-slate-50 ${hasActive ? "text-accent" : "text-muted"}`}
                            aria-expanded={open}
                        >
                            {g.label}
                            <span className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                        </button>
                        {open ? (
                            <ul className="mt-0.5 space-y-0.5">
                                {g.items.map((i) => {
                                    const active = isActive(pathname, i.href);
                                    return (
                                        <li key={i.href}>
                                            <PrefetchLink
                                                href={i.href}
                                                onClick={() => setDrawerOpen(false)}
                                                className={`block rounded-lg px-2 py-1.5 text-sm transition ${active ? "bg-slate-100 font-medium text-brand" : "text-muted hover:bg-slate-50 hover:text-brand"}`}
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
