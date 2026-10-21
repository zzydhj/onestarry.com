import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AdminNav } from "@/components/AdminNav";
import { readAdminSession } from "@/lib/auth";
import { maintenanceAlert, PERMISSIONS } from "@onestarry/core";

export const metadata: Metadata = {
    title: "onestarry · Admin",
    description: "OneStarry 管理后台",
    robots: { index: false, follow: false },
};

// 后台整棵路由树均不得静态预渲染：布局要读会话/权限（需 Workers 上下文），
// 而 next build 会先预渲染 /signin → 不强制动态就会在构建期调 getCloudflareContext 而报错。
export const dynamic = "force-dynamic";

/**
 * 后台根布局。软取会话（不跳转）把权限集交给导航，实现「按权限显示入口」——
 * 导航隐藏只是体验，真正的强制仍在各页 requirePermission 与 Server Action 里。
 * 未登录（/signin）时 permissions 为空，导航只剩「概览」，且 /signin 路由本身会隐藏整条导航。
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
    const session = await readAdminSession();
    // 维护窗口提醒同样只给 config:write（升级是超管的责任）。
    // 本模板的维护者不看依赖报告、不做月度巡检 —— 后台导航条就是唯一触发器，
    // 所以文案里必须带**具体开工日**而不是“还剩几天”。
    const alert = session?.permissions.has(PERMISSIONS.configWrite) ? maintenanceAlert() : null;
    return (
        <html lang="zh">
            <body className="min-h-screen bg-white text-fg antialiased">
                <AdminNav permissions={session ? [...session.permissions] : []} alert={alert} />
                {children}
            </body>
        </html>
    );
}
