import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 后台概览（受保护）：未登录由 requireAdmin 跳转 /signin。 */
export default async function AdminHome() {
    await requireAdmin();

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                    { href: "/products", label: "商品管理" },
                    { href: "/orders", label: "订单管理" },
                    { href: "/categories", label: "类目管理" },
                    { href: "/markets", label: "市场配置" },
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
        </div>
    );
}
