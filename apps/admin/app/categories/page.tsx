import { createDb, listAllCategories, mapCurrentSlugsByEntity } from "@onestarry/db";
import Link from "next/link";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { Button, Input, Select } from "@onestarry/ui";
import { createCategoryAction, updateCategoryAction } from "./actions";

export const dynamic = "force-dynamic";

/** 类目管理（受保护）：树状列表 + 新增（选父级/slug）+ 改名/改 slug。 */
export default async function CategoriesPage() {
    const { env } = await requirePermission(PERMISSIONS.categoryWrite);
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cats = await listAllCategories(db);
    // 一次查回全部当前 slug（旧写法是逐条 getEntitySlug，N 个类目 = N 次跨洋往返）
    const slugById = await mapCurrentSlugsByEntity(db, "category");
    const parentOptions = [{ id: "", name: "（顶层）" }, ...cats.map((c) => ({ id: c.id, name: "　".repeat(c.level - 1) + c.name }))];

    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">类目管理 <span className="text-sm font-normal text-muted">（{cats.length}）</span></h1>

            <form action={createCategoryAction} className="mt-5 flex flex-wrap items-center gap-2">
                <Input name="name" placeholder="新类目名称" required className="py-1.5" />
                <Input name="slug" placeholder="slug（留空自动生成）" className="py-1.5 w-44" />
                <Select name="parentId" className="py-1.5">
                    {parentOptions.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </Select>
                <Button type="submit" size="sm">新增</Button>
            </form>

            {cats.length === 0 && (
                <p className="mt-6 text-sm text-muted">暂无类目，用上方表单新增第一个。</p>
            )}

            <ul className="mt-6 space-y-2">
                {cats.map((c) => (
                    <li key={c.id} className="flex items-center gap-2" style={{ marginLeft: (c.level - 1) * 22 }}>
                        <form action={updateCategoryAction} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={c.id} />
                            <Input name="name" defaultValue={c.name} className="px-2 py-1 text-sm w-40" />
                            <Input name="slug" defaultValue={slugById.get(c.id) ?? ""} placeholder="slug" className="px-2 py-1 text-sm w-40 font-mono" />
                            <Button type="submit" variant="secondary" size="sm">保存</Button>
                        </form>
                        <Link href={`/categories/${c.id}/attributes`} prefetch={false} className="text-xs text-muted transition hover:text-accent">属性</Link>
                        <span className="text-xs text-muted">L{c.level}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
