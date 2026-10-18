"use server";

import { revalidatePath } from "next/cache";
import { createDb, createCategory, renameCategory } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";

/** 新增类目（可选父级）。 */
export async function createCategoryAction(formData: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const name = String(formData.get("name") ?? "").trim();
    const parentId = String(formData.get("parentId") ?? "").trim() || null;
    if (!name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await createCategory(db, { name, parentId });
    revalidatePath("/categories");
}

/** 重命名类目。 */
export async function renameCategoryAction(formData: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!id || !name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await renameCategory(db, { id, name });
    revalidatePath("/categories");
}
