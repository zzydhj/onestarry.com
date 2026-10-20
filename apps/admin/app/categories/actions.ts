"use server";

import { revalidatePath } from "next/cache";
import { createDb, createCategory, updateCategory } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";

/** 新增类目（可选父级；slug 缺省由名称派生，写入 slugs 表使前台可达）。 */
export async function createCategoryAction(formData: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    const parentId = String(formData.get("parentId") ?? "").trim() || null;
    if (!name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await createCategory(db, { name, parentId, slug });
    revalidatePath("/categories");
}

/** 更新类目名 + slug（slug 留空则不改，避免破坏已索引 URL）。 */
export async function updateCategoryAction(formData: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!id || !name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await updateCategory(db, { id, name, slug });
    revalidatePath("/categories");
}
