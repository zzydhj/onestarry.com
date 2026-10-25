"use server";

import { createCategory, updateCategory } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { queueEntityPageInvalidation } from "@/lib/invalidate";

/**
 * 动作返回值：类目页现在是乐观 UI（点下就先变），所以**必须**把成败告诉调用方。
 * 旧写法返回 void，失败时前端无从分辨，"已保存"和"其实没保存"长得一模一样 —— 那比慢严重得多。
 */
export type CategoryCreateResult = { ok: true; slug: string } | { ok: false; error: string };
export type CategoryUpdateResult = { ok: true; slug: string | null } | { ok: false; error: string };

/** 只把 Error.message 递到前端，不吞 redirect()/FORBIDDEN 这类控制流异常（守卫在 try 外面）。 */
function fail(e: unknown): { ok: false; error: string } {
    return { ok: false, error: e instanceof Error ? e.message : "写入失败" };
}

/** 新增类目（可选父级；slug 缺省由名称派生，写入 slugs 表使前台可达）。 */
export async function createCategoryAction(formData: FormData): Promise<CategoryCreateResult> {
    const { env, ctx } = await requirePermission(PERMISSIONS.categoryWrite);
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    const parentId = String(formData.get("parentId") ?? "").trim() || null;
    if (!name) return { ok: false, error: "名称不能为空" };
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    let finalSlug: string;
    let createdId: string;
    try {
        // setEntitySlug 会自动避让重名（my-mug → my-mug-2），所以最终 slug 可能不等于输入的那一个
        ({ id: createdId, slug: finalSlug } = await createCategory(db, { name, parentId, slug }));
    } catch (e) {
        return fail(e);
    }
    queueEntityPageInvalidation({ ctx, db, kind: "category", entityId: createdId, slug: finalSlug });
    return { ok: true, slug: finalSlug };
}

/** 更新类目名 + slug（slug 留空则不改，避免破坏已索引 URL）。 */
export async function updateCategoryAction(formData: FormData): Promise<CategoryUpdateResult> {
    const { env, ctx } = await requirePermission(PERMISSIONS.categoryWrite);
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!id) return { ok: false, error: "缺少类目 id" };
    if (!name) return { ok: false, error: "名称不能为空" };
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    let finalSlug: string | null;
    try {
        finalSlug = await updateCategory(db, { id, name, slug });
    } catch (e) {
        return fail(e);
    }
    // slug 未改时 updateCategory 返回 null，helper 会自己现查当前 slug 去失效那一页
    queueEntityPageInvalidation({ ctx, db, kind: "category", entityId: id, slug: finalSlug });
    return { ok: true, slug: finalSlug };
}
