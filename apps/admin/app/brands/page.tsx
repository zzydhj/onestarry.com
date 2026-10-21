import { createBrand, createDb, listAllBrands } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { Button, Input } from "@onestarry/ui";
import { createBrandAction, updateBrandAction } from "./actions";

export const dynamic = "force-dynamic";

/** 品牌管理（受保护）：列表 + 新增（slug）+ 改名/改 slug。 */
export default async function BrandsPage() {
    const { env } = await requirePermission(PERMISSIONS.categoryWrite);
    const db = createDb(env.HYPERDRIVE.connectionString);
    const brands = await listAllBrands(db);

    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">品牌管理 <span className="text-sm font-normal text-muted">（{brands.length}）</span></h1>

            <form action={createBrandAction} className="mt-5 flex flex-wrap items-center gap-2">
                <Input name="name" placeholder="新品牌名称" required className="py-1.5" />
                <Input name="slug" placeholder="slug（留空自动生成）" className="py-1.5 w-44" />
                <Button type="submit" size="sm">新增</Button>
            </form>

            {brands.length === 0 && (
                <p className="mt-6 text-sm text-muted">暂无品牌，用上方表单新增第一个。</p>
            )}

            <ul className="mt-6 space-y-2">
                {brands.map((b) => (
                    <li key={b.id}>
                        <form action={updateBrandAction} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={b.id} />
                            <Input name="name" defaultValue={b.name} className="px-2 py-1 text-sm w-44" />
                            <Input name="slug" defaultValue={b.slug ?? ""} placeholder="slug" className="px-2 py-1 text-sm w-44 font-mono" />
                            <Button type="submit" variant="secondary" size="sm">保存</Button>
                        </form>
                    </li>
                ))}
            </ul>
        </div>
    );
}
