"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { makeAuthClient } from "@onestarry/auth/client";

const authClient = makeAuthClient();

const LINKS = [
    { href: "/", label: "概览" },
    { href: "/products", label: "商品" },
    { href: "/orders", label: "订单" },
    { href: "/categories", label: "类目" },
    { href: "/brands", label: "品牌" },
    { href: "/attributes", label: "属性" },
    { href: "/reviews", label: "评论" },
    { href: "/markets", label: "市场" },
    { href: "/team", label: "团队" },
];

/** 后台顶部导航（中文）。登录页不显示。 */
export function AdminNav() {
    const pathname = usePathname();
    const router = useRouter();
    if (pathname === "/signin") return null;

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
                        {LINKS.map((l) => {
                            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
                            return (
                                <Link
                                    key={l.href}
                                    href={l.href}
                                    className={active ? "font-medium text-accent" : "text-muted transition hover:text-brand"}
                                >
                                    {l.label}
                                </Link>
                            );
                        })}
                    </nav>
                </div>
                <button onClick={logout} className="text-sm text-muted transition hover:text-red-600">
                    登出
                </button>
            </div>
        </header>
    );
}
