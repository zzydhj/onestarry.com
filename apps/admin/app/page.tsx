import Link from "next/link";
import { PERMISSIONS, computeMaintenanceWindow, readIsrHealthReport } from "@onestarry/core";
import { createDb, getOutboxHealth } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { OpsPanel } from "@/components/OpsPanel";

export const dynamic = "force-dynamic";

/** 后台概览（受保护）：未登录由 requireAdmin 跳转 /signin。 */
export default async function AdminHome() {
    const { env, permissions } = await requireAdmin();

    // 运维面板（依赖支持窗口 + outbox 流水线 + ISR 缓存健康）只对 config:write 渲染：它暴露版本与内部状态。
    // outbox 走 Neon、isr 走 R2：两个不同后端，并行拿掉一段串行等待（同一后端并行无收益，见 docs/PERF.md）。
    const opsData = permissions.has(PERMISSIONS.configWrite)
        ? await Promise.all([
            getOutboxHealth(createDb(env.HYPERDRIVE.connectionString)),
            readIsrHealthReport((key) => env.ISR_CACHE.get(key)),
        ])
        : null;
    const ops = opsData ? { window: computeMaintenanceWindow(), outbox: opsData[0], isr: opsData[1] } : null;

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                    { href: "/products", label: "商品管理" },
                    { href: "/orders", label: "订单管理" },
                    { href: "/categories", label: "类目管理" },
                    { href: "/brands", label: "品牌管理" },
                    { href: "/markets", label: "市场配置" },
                    { href: "/legal", label: "法律文档" },
                    { href: "/reviews", label: "评论审核" },
                    { href: "/team", label: "团队管理" },
                ].map((c) => (
                    <Link
                        key={c.href}
                        href={c.href}
                        className="rounded-xl border border-line bg-white p-4 font-medium transition hover:border-accent hover:shadow-sm"
                    >
                        {c.label}
                    </Link>
                ))}
            </div>
            <p className="mt-6 text-sm text-muted">改价 / 上下架 / 库存 / 新建 / 图片 / 图文详情 / 批量导入 均在「商品管理」内。</p>
            {ops && <OpsPanel window={ops.window} outbox={ops.outbox} isr={ops.isr} />}
        </div>
    );
}
