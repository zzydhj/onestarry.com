import Link from "next/link";
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@onestarry/core";
import { getContentForEdit } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Button, Input, Select, Textarea, Label } from "@onestarry/ui";
import { ContentEditor } from "../ContentEditor";
import { saveContentMetaAction, publishContentAction, deleteContentAction } from "../actions";

export const dynamic = "force-dynamic";

/** 内容编辑页（受保护）：元数据表单 + 正文编辑器 + 发布状态 + 删除。 */
export default async function ContentEditPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await requirePermission(PERMISSIONS.seoWrite);
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const item = await getContentForEdit(db, id);
    if (!item) notFound();

    return (
        <main className="mx-auto max-w-3xl px-4 py-8">
            <Link href="/content" className="text-sm text-muted transition hover:text-accent">
                ← 返回内容列表
            </Link>
            <h1 className="mt-2 text-xl font-semibold">编辑内容</h1>

            {/* 元数据 */}
            <form action={saveContentMetaAction} className="mt-6 space-y-3">
                <input type="hidden" name="id" value={item.id} />
                <div>
                    <Label>标题</Label>
                    <Input name="title" defaultValue={item.title} required className="mt-1" />
                </div>
                <div>
                    <Label>摘要（列表 / SEO 用）</Label>
                    <Textarea name="excerpt" defaultValue={item.excerpt ?? ""} rows={2} className="mt-1" />
                </div>
                <div className="flex flex-wrap gap-3">
                    <div className="min-w-[12rem] flex-1">
                        <Label>URL slug</Label>
                        <Input name="slug" defaultValue={item.urlSlug ?? ""} placeholder="留空则按标题生成" className="mt-1" />
                    </div>
                    <div className="min-w-[10rem]">
                        <Label>类型</Label>
                        <Select name="type" defaultValue={item.type} className="mt-1">
                            <option value="page">页面</option>
                            <option value="blog">博客</option>
                            <option value="landing">落地页</option>
                        </Select>
                    </div>
                </div>
                <Button type="submit" size="sm">
                    保存信息
                </Button>
            </form>

            {/* 正文 */}
            <div className="mt-8">
                <Label>正文</Label>
                <div className="mt-1">
                    <ContentEditor contentId={item.id} initial={(item.body as Record<string, unknown> | null) ?? null} />
                </div>
            </div>

            {/* 发布状态 */}
            <form action={publishContentAction} className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <input type="hidden" name="id" value={item.id} />
                <Label>状态</Label>
                <Select name="status" defaultValue={item.status} className="py-1.5 text-sm">
                    <option value="draft">草稿</option>
                    <option value="published">发布</option>
                    <option value="archived">归档</option>
                </Select>
                <Button type="submit" size="sm">
                    更新状态
                </Button>
            </form>

            {/* 删除 */}
            <form action={deleteContentAction} className="mt-4 flex items-center gap-3 border-t border-line pt-4">
                <input type="hidden" name="id" value={item.id} />
                <Button type="submit" size="sm">
                    删除内容
                </Button>
                <span className="text-xs text-muted">删除后其 slug 一并清理，前台不再可达。</span>
            </form>
        </main>
    );
}
