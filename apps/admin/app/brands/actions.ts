"use server";

import { createBrand, createDb, updateBrand } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { queueEntityPageInvalidation } from "@/lib/invalidate";

/** 新增品牌（slug 缺省由名称派生，写入 slugs 表使前台 /brands/[slug] 可达）。 */
export async function createBrandAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.categoryWrite);
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const created = await createBrand(db, { name, slug });
    queueEntityPageInvalidation({ ctx, db, kind: "brand", entityId: created.id, slug: created.slug });
}

/** 更新品牌名 + slug（slug 留空则不改，避免破坏已索引 URL）。 */
export async function updateBrandAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.categoryWrite);
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!id || !name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const newSlug = await updateBrand(db, { id, name, slug });
    // 没改 slug 时 updateBrand 返回 null，helper 会自己现查当前 slug：名称变了，那一页也得重渲染
    queueEntityPageInvalidation({ ctx, db, kind: "brand", entityId: id, slug: newSlug });
}
