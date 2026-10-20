import { and, desc, eq } from "drizzle-orm";
import { content, contentTranslations, slugs } from "../schema";
import { getEntitySlug, resolveSlug, setEntitySlug } from "./slug";
import type { Db, Tx } from "../client";

/**
 * 内容管理（CMS）查询层。复用已建物理表 content + content_translations（0001 迁移即建，无新表）。
 * slug 走 slugs 单一真源（entityType="content"），SEO 走 seo_meta（entityType="content"）。见 §15.1。
 */

export type ContentType = "blog" | "page" | "landing";
export type ContentStatus = "draft" | "published" | "archived";

/** 后台列表行。 */
export interface ContentListItem {
    id: string;
    type: string;
    status: string;
    title: string | null;
    urlSlug: string | null;
    publishedAt: string | null;
    updatedAt: Date;
}

/** 后台：全部内容（按更新时间倒序），带 en 标题与当前 slug。 */
export async function listContent(db: Db | Tx): Promise<ContentListItem[]> {
    return db
        .select({
            id: content.id,
            type: content.type,
            status: content.status,
            title: contentTranslations.title,
            urlSlug: slugs.slug,
            publishedAt: content.publishedAt,
            updatedAt: content.updatedAt,
        })
        .from(content)
        .leftJoin(
            contentTranslations,
            and(eq(contentTranslations.contentId, content.id), eq(contentTranslations.locale, "en")),
        )
        .leftJoin(
            slugs,
            and(
                eq(slugs.entityId, content.id),
                eq(slugs.entityType, "content"),
                eq(slugs.locale, "en"),
                eq(slugs.isCurrent, true),
            ),
        )
        .orderBy(desc(content.updatedAt));
}

export interface ContentEditData {
    id: string;
    type: string;
    status: string;
    title: string;
    excerpt: string | null;
    body: unknown;
    urlSlug: string | null;
}

/** 编辑取：content + 指定 locale 译文 + 当前 slug。无 content 返回 null；无译文时标题回落占位。 */
export async function getContentForEdit(db: Db | Tx, id: string, locale = "en"): Promise<ContentEditData | null> {
    const c = (await db.select().from(content).where(eq(content.id, id)).limit(1))[0];
    if (!c) return null;
    const tr = (
        await db
            .select()
            .from(contentTranslations)
            .where(and(eq(contentTranslations.contentId, id), eq(contentTranslations.locale, locale)))
            .limit(1)
    )[0];
    const urlSlug = await getEntitySlug(db, { entityType: "content", entityId: id, locale });
    return {
        id: c.id,
        type: c.type,
        status: c.status,
        title: tr?.title ?? "",
        excerpt: tr?.excerpt ?? null,
        body: tr?.body ?? null,
        urlSlug,
    };
}

/**
 * 建/改内容（幂等 upsert）：无 id 则新建 content 行；写/更新 content_translations（按 locale 唯一）；
 * slug 经 setEntitySlug（与当前不同才动、旧 slug 降历史 → 前台自动 301）。返回 content id。
 */
export async function upsertContent(
    db: Db | Tx,
    input: {
        id?: string;
        type: ContentType;
        locale?: string;
        title: string;
        excerpt?: string | null;
        body?: unknown;
        slug?: string;
    },
): Promise<string> {
    const locale = input.locale ?? "en";
    let id = input.id;
    if (id) {
        await db.update(content).set({ type: input.type, updatedAt: new Date() }).where(eq(content.id, id));
    } else {
        const [row] = await db.insert(content).values({ type: input.type }).returning({ id: content.id });
        id = row!.id;
    }
    const existing = (
        await db
            .select({ id: contentTranslations.id })
            .from(contentTranslations)
            .where(and(eq(contentTranslations.contentId, id), eq(contentTranslations.locale, locale)))
            .limit(1)
    )[0];
    if (existing) {
        const patch: Record<string, unknown> = { title: input.title, excerpt: input.excerpt ?? null, updatedAt: new Date() };
        if (input.body !== undefined) patch.body = input.body; // 未传 body 则保留原正文（供只改标题/slug 的表单）
        await db.update(contentTranslations).set(patch).where(eq(contentTranslations.id, existing.id));
    } else {
        await db
            .insert(contentTranslations)
            .values({ contentId: id, locale, title: input.title, excerpt: input.excerpt ?? null, body: input.body ?? null });
    }
    await setEntitySlug(db, { entityType: "content", entityId: id, slug: input.slug || input.title, locale });
    return id;
}

/** 只更新正文 body（编辑器用，不动 title/excerpt/slug）。 */
export async function updateContentBody(db: Db | Tx, input: { id: string; body: unknown; locale?: string }): Promise<void> {
    const locale = input.locale ?? "en";
    await db
        .update(contentTranslations)
        .set({ body: input.body, updatedAt: new Date() })
        .where(and(eq(contentTranslations.contentId, input.id), eq(contentTranslations.locale, locale)));
}

/** 改发布状态；转 published 且首次则盖 publishedAt（ISO 文本）。 */
export async function setContentStatus(db: Db | Tx, id: string, status: ContentStatus): Promise<void> {
    const cur = (await db.select({ publishedAt: content.publishedAt }).from(content).where(eq(content.id, id)).limit(1))[0];
    const patch: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "published" && !cur?.publishedAt) patch.publishedAt = new Date().toISOString();
    await db.update(content).set(patch).where(eq(content.id, id));
}

/** 删除内容：连带清掉其 slugs 行（内容已删、历史 301 无意义），避免同名新内容被顶成 -2；content_translations 级联删。 */
export async function deleteContent(db: Db | Tx, id: string): Promise<void> {
    await db.delete(slugs).where(and(eq(slugs.entityType, "content"), eq(slugs.entityId, id)));
    await db.delete(content).where(eq(content.id, id));
}

export interface PublishedContent {
    id: string;
    type: string;
    title: string;
    excerpt: string | null;
    body: unknown;
    publishedAt: string | null;
    slug: string;
}

/**
 * 前台：按 slug 取已发布内容。命中历史 slug → { redirect }；未命中或非 published → null（调用方 404）。
 */
export async function getPublishedContentBySlug(
    db: Db | Tx,
    slug: string,
    locale = "en",
): Promise<{ data: PublishedContent } | { redirect: string } | null> {
    const res = await resolveSlug(db, { entityType: "content", locale, slug });
    if (!res) return null;
    if (res.status === "redirect") return { redirect: res.toSlug };
    const c = (await db.select().from(content).where(eq(content.id, res.entityId)).limit(1))[0];
    if (!c || c.status !== "published") return null;
    const tr = (
        await db
            .select()
            .from(contentTranslations)
            .where(and(eq(contentTranslations.contentId, c.id), eq(contentTranslations.locale, locale)))
            .limit(1)
    )[0];
    return {
        data: {
            id: c.id,
            type: c.type,
            title: tr?.title ?? "",
            excerpt: tr?.excerpt ?? null,
            body: tr?.body ?? null,
            publishedAt: c.publishedAt,
            slug: res.slug,
        },
    };
}

export interface ContentSummary {
    id: string;
    type: string;
    title: string;
    excerpt: string | null;
    publishedAt: string | null;
    urlSlug: string | null;
}

/** 前台列表：某 type 的全部已发布内容（按 publishedAt 倒序），带 slug/excerpt。 */
export async function listPublishedContent(db: Db | Tx, type: ContentType, locale = "en"): Promise<ContentSummary[]> {
    return db
        .select({
            id: content.id,
            type: content.type,
            title: contentTranslations.title,
            excerpt: contentTranslations.excerpt,
            publishedAt: content.publishedAt,
            urlSlug: slugs.slug,
        })
        .from(content)
        .innerJoin(contentTranslations, and(eq(contentTranslations.contentId, content.id), eq(contentTranslations.locale, locale)))
        .leftJoin(
            slugs,
            and(
                eq(slugs.entityId, content.id),
                eq(slugs.entityType, "content"),
                eq(slugs.locale, locale),
                eq(slugs.isCurrent, true),
            ),
        )
        .where(and(eq(content.type, type), eq(content.status, "published")))
        .orderBy(desc(content.publishedAt));
}
