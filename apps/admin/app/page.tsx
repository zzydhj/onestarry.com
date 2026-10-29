import Link from "next/link";
import { PERMISSIONS, computeMaintenanceWindow, readIsrHealthReport } from "@onestarry/core";
import { getOutboxHealth } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { dashboardCards } from "@/lib/nav";
import { OpsPanel } from "@/components/OpsPanel";

export const dynamic = "force-dynamic";

/** 后台概览（受保护）：未登录由 requireAdmin 跳转 /signin。 */
export default async function AdminHome() {
    const { env, permissions } = await requireAdmin();

    // 运维面板（依赖支持窗口 + outbox 流水线 + ISR 缓存健康）只对 config:write 渲染：它暴露版本与内部状态。
    // outbox 走 Neon、isr 走 R2：两个不同后端，并行拿掉一段串行等待（同一后端并行无收益，见 docs/PERF.md）。
    const opsData = permissions.has(PERMISSIONS.configWrite)
        ? await Promise.all([
            getOutboxHealth(getRequestDb(env.HYPERDRIVE.connectionString)),
            readIsrHealthReport((key) => env.ISR_CACHE.get(key)),
        ])
        : null;
    const ops = opsData ? { window: computeMaintenanceWindow(), outbox: opsData[0], isr: opsData[1] } : null;

    // 入口卡片不在此处列清单（审查 L-1）：与左侧导航共用 lib/nav 那一张表，并按权限过滤。
    // 以前这里抄了一份无 perm 的副本，导致 staff 看得到「市场」「团队权限」卡片，
    // 点进去就撞 requirePermission 抛的 FORBIDDEN —— 同一条规则写两遍必然漂移。
    const cards = dashboardCards(permissions);

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {cards.map((c) => (
                    <Link
                        key={c.href}
                        href={c.href}
                        className="rounded-xl border border-line bg-white p-4 font-medium transition hover:border-accent hover:shadow-sm"
                    >
                        {c.label}
                        {c.hint ? <span className="mt-1 block text-xs font-normal leading-snug text-muted">{c.hint}</span> : null}
                    </Link>
                ))}
            </div>
            {ops && <OpsPanel window={ops.window} outbox={ops.outbox} isr={ops.isr} />}
        </div>
    );
}
