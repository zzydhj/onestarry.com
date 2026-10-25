"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@onestarry/core";
import {
    getContentForEdit,
    upsertContent,
    updateContentBody,
    setContentStatus,
    deleteContent,
    type ContentType,
    type ContentStatus,
} from "@onestarry/db";
import { requirePermission } from "@/lib/auth";
import { getRequestDb } from "@/lib/db";
import { contentStorefrontPaths, queueContentInvalidation, queuePathsInvalidation } from "@/lib/invalidate";

const TYPES: readonly string[] = ["blog", "page", "landing"];
const STATUSES: readonly ContentStatus[] = ["draft", "published", "archived"];

function asType(v: string): ContentType {
    return (TYPES.includes(v) ? v : "page") as ContentType;
}

/** 新建内容（列表页表单：type + title）→ 建 draft → 跳编辑页。需 seoWrite。 */
export async function createContentAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.seoWrite);
    const type = asType(String(formData.get("type") ?? "page"));
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const id = await upsertContent(db, { type, title });
    redirect(`/content/${id}`);
}

/** 保存元数据（标题/摘要/slug/类型），不碰正文（body 由编辑器单独存）。 */
export async function saveContentMetaAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.seoWrite);
    const id = String(formData.get("id") ?? "");
    const type = asType(String(formData.get("type") ?? "page"));
    const title = String(formData.get("title") ?? "").trim();
    const excerpt = String(formData.get("excerpt") ?? "").trim() || null;
    const slug = String(formData.get("slug") ?? "").trim() || undefined;
    if (!id || !title) return;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await upsertContent(db, { id, type, title, excerpt, slug });
    revalidatePath("/content");
    revalidatePath(`/content/${id}`);
    // 上面两条只管后台自己；前台那一篇（/blog/<slug> 或 /<slug>）要靠跨 Worker 通知。
    queueContentInvalidation({ ctx, db, contentId: id });
}

/** 保存正文（编辑器传 ProseMirror JSON 字符串）→ 只更新 body。 */
export async function saveContentBodyAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.seoWrite);
    const id = String(formData.get("id") ?? "");
    const raw = String(formData.get("body") ?? "");
    if (!id) return;
    let parsed: unknown = null;
    try {
        parsed = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
        return; // JSON 不合法：忽略
    }
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await updateContentBody(db, { id, body: parsed });
    revalidatePath(`/content/${id}`);
    queueContentInvalidation({ ctx, db, contentId: id });
}

/** 改发布状态（草稿/发布/归档）。 */
export async function publishContentAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.seoWrite);
    const id = String(formData.get("id") ?? "");
    const rawStatus = String(formData.get("status") ?? "");
    const status = STATUSES.find((s) => s === rawStatus);
    if (!id || !status) return;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await setContentStatus(db, id, status);
    revalidatePath("/content");
    revalidatePath(`/content/${id}`);
    // 发布/撤回都改了前台那一篇的存亡，不失效就要等整点（这些页 revalidate 比商品长得多）
    queueContentInvalidation({ ctx, db, contentId: id });
}

/** 删除内容 → 返回列表。 */
export async function deleteContentAction(formData: FormData): Promise<void> {
    const { env, ctx } = await requirePermission(PERMISSIONS.seoWrite);
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    // 先读再删：删完就不知道它原本挂在哪个 URL 上（前台那一页得按原地址失效）
    const row = await getContentForEdit(db, id);
    await deleteContent(db, id);
    revalidatePath("/content");
    queuePathsInvalidation({ ctx, paths: contentStorefrontPaths(row) });
    redirect("/content");
}
