import { createDb, listAllCategories } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { Button, Input, Select } from "@onestarry/ui";
import { createCategoryAction, renameCategoryAction } from "./actions";

export const dynamic = "force-dynamic";

/** 类目管理（受保护）：树状列表 + 新增（选父级）+ 重命名。 */
export default async function CategoriesPage() {
    const { env } = await requireAdmin();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cats = await listAllCategories(db);
    const parentOptions = [{ id: "", name: "（顶层）" }, ...cats.map((c) => ({ id: c.id, name: "　".repeat(c.level - 1) + c.name }))];

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">类目管理 <span className="text-sm font-normal text-muted">（{cats.length}）</span></h1>

            <form action={createCategoryAction} className="mt-5 flex items-center gap-2">
                <Input name="name" placeholder="新类目名称" required className="py-1.5" />
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
                        <form action={renameCategoryAction} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={c.id} />
                            <Input name="name" defaultValue={c.name} className="px-2 py-1 text-sm" />
                            <Button type="submit" variant="secondary" size="sm">改名</Button>
                        </form>
                        <span className="text-xs text-muted">L{c.level}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
