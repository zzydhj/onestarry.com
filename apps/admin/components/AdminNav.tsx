"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { makeAuthClient } from "@onestarry/auth/client";
import type { MaintenanceAlert, PermissionKey } from "@onestarry/core";

const authClient = makeAuthClient();

/** 导航入口 + 其所需权限点（无 perm = 任意后台账号可见）。与页面/动作的 requirePermission 一一对应。 */
const LINKS: { href: string; label: string; perm?: PermissionKey }[] = [
    { href: "/", label: "概览" },
    { href: "/products", label: "商品", perm: "product:write" },
    { href: "/orders", label: "订单", perm: "order:write" },
    { href: "/categories", label: "类目", perm: "category:write" },
    { href: "/brands", label: "品牌", perm: "category:write" },
    { href: "/attributes", label: "属性", perm: "config:write" },
    { href: "/reviews", label: "评论", perm: "product:write" },
    { href: "/content", label: "内容", perm: "seo:write" },
    { href: "/legal", label: "法律", perm: "seo:write" },
    { href: "/markets", label: "市场", perm: "market:write" },
    { href: "/team", label: "团队", perm: "role:manage" },
];

/**
 * 后台顶部导航（中文）。按传入权限集过滤入口；登录页不显示。
 * 注意：隐藏入口只是体验优化，服务端仍有 requirePermission 硬强制。
 * alert：维护窗口提醒（由服务端按权限算好传入）——不只在概览页显示，
 * 因为维护者可能从任何页面进来，导航条才是真正能看见的触发器。
 */
export function AdminNav({ permissions = [], alert = null }: { permissions?: PermissionKey[]; alert?: MaintenanceAlert | null }) {
    const pathname = usePathname();
    const router = useRouter();
    if (pathname === "/signin") return null;

    const allowed = new Set<string>(permissions);
    const links = LINKS.filter((l) => !l.perm || allowed.has(l.perm));

    async function logout() {
        await authClient.signOut();
        router.push("/signin");
        router.refresh();
    }

    return (
        <header className="border-b border-line bg-white">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <div className="flex items-center gap-6">
                    <span className="text-lg font-semibold tracking-tight text-brand">onestarry · 后台</span>
                    <nav className="flex items-center gap-4 text-sm">
                        {links.map((l) => {
                            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
                            return (
                                <Link
                                    key={l.href}
                                    href={l.href}
                                    className={active ? "font-medium text-accent" : "text-muted transition hover:text-brand"}
                                >
                                    {l.label}
                                    {l.href === "/" && alert ? (
                                        <span
                                            aria-label="有维护事项待处理"
                                            className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${alert.level === "expired" ? "bg-red-500" : "bg-amber-500"}`}
                                        />
                                    ) : null}
                                </Link>
                            );
                        })}
                    </nav>
                </div>
                <div className="flex items-center gap-4">
                    {alert ? (
                        <Link
                            href="/"
                            className={`hidden max-w-[22rem] truncate rounded-lg border px-2 py-1 text-xs font-medium md:inline-block ${alert.level === "expired" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                        >
                            {alert.text}
                        </Link>
                    ) : null}
                    <button onClick={logout} className="text-sm text-muted transition hover:text-red-600">
                        登出
                    </button>
                </div>
            </div>
        </header>
    );
}
