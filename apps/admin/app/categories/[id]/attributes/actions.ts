"use server";

import { revalidatePath } from "next/cache";
import { createDb, removeCategoryAttribute, setCategoryAttribute } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";

/** 把某属性挂到类目（默认继承属性定义本身）。 */
export async function attachCategoryAttributeAction(formData: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const categoryId = String(formData.get("categoryId") ?? "");
    const attributeId = String(formData.get("attributeId") ?? "");
    if (!categoryId || !attributeId) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await setCategoryAttribute(db, { categoryId, attributeId });
    revalidatePath(`/categories/${categoryId}/attributes`);
}

/** 从类目解除某属性（只删关联行，不动全局定义）。 */
export async function removeCategoryAttributeAction(formData: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const categoryId = String(formData.get("categoryId") ?? "");
    const attributeId = String(formData.get("attributeId") ?? "");
    if (!categoryId || !attributeId) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await removeCategoryAttribute(db, { categoryId, attributeId });
    revalidatePath(`/categories/${categoryId}/attributes`);
}
