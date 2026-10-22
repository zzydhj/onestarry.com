import { createDb, listAllCategories, mapCurrentSlugsByEntity } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { CategoryManager } from "./CategoryManager";

export const dynamic = "force-dynamic";

/**
 * 类目管理（受保护）：树状列表 + 新增（选父级/slug）+ 改名/改 slug。
 * 列表与两个表单都在客户端组件里做乐观更新；这里只负责取真值并传下去。
 */
export default async function CategoriesPage() {
    const { env } = await requirePermission(PERMISSIONS.categoryWrite);
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cats = await listAllCategories(db);
    // 一次查回全部当前 slug（旧写法是逐条 getEntitySlug，N 个类目 = N 次跨洋往返）
    const slugById = await mapCurrentSlugsByEntity(db, "category");

    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">类目管理 <span className="text-sm font-normal text-muted">（{cats.length}）</span></h1>

            <CategoryManager cats={cats} slugById={Object.fromEntries(slugById)} />
        </div>
    );
}
