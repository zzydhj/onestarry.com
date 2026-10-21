"use server";

import { revalidatePath } from "next/cache";
import { createBrand, createDb, updateBrand } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";

/** 新增品牌（slug 缺省由名称派生，写入 slugs 表使前台 /brands/[slug] 可达）。 */
export async function createBrandAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.categoryWrite);
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await createBrand(db, { name, slug });
    revalidatePath("/brands");
}

/** 更新品牌名 + slug（slug 留空则不改，避免破坏已索引 URL）。 */
export async function updateBrandAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.categoryWrite);
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!id || !name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await updateBrand(db, { id, name, slug });
    revalidatePath("/brands");
}
