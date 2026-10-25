import { PrefetchLink } from "@/components/PrefetchLink";
import { PERMISSIONS } from "@onestarry/core";
import { listContent } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Button, Input, Select, TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";
import { createContentAction } from "./actions";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = { blog: "博客", page: "页面", landing: "落地页" };
const STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", archived: "已归档" };

/** 内容管理列表（受保护）：列全部内容 + 新建（选类型 + 标题）。需 seoWrite。 */
export default async function ContentListPage() {
    const { env } = await requirePermission(PERMISSIONS.seoWrite);
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const items = await listContent(db);

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-xl font-semibold">
                内容管理 <span className="ml-1 text-sm font-normal text-muted">（{items.length}）</span>
            </h1>
            <p className="mt-1 text-sm text-muted">页面（About/FAQ/政策）、博客文章、落地页统一在此管理。发布后前台按 slug 可达。</p>

            <form action={createContentAction} className="mt-4 flex flex-wrap items-center gap-2">
                <Select name="type" className="py-1.5 text-sm">
                    <option value="page">页面（About/FAQ/政策）</option>
                    <option value="blog">博客文章</option>
                    <option value="landing">落地页</option>
                </Select>
                <Input name="title" placeholder="标题" required className="w-64 py-1.5 text-sm" />
                <Button type="submit" size="sm">
                    新建
                </Button>
            </form>

            {items.length === 0 ? (
                <p className="mt-6 text-sm text-muted">还没有内容，用上方表单新建。</p>
            ) : (
                <TableFrame className="mt-6">
                    <table className="w-full text-sm">
                        <THead>
                            <tr>
                                <Th>标题</Th>
                                <Th>类型</Th>
                                <Th>状态</Th>
                                <Th>slug</Th>
                                <Th>更新</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {items.map((it) => (
                                <Tr key={it.id}>
                                    <Td>
                                        <PrefetchLink href={`/content/${it.id}`} className="text-brand transition hover:text-accent">
                                            {it.title ?? "（无标题）"}
                                        </PrefetchLink>
                                    </Td>
                                    <Td>{TYPE_LABELS[it.type] ?? it.type}</Td>
                                    <Td>{STATUS_LABELS[it.status] ?? it.status}</Td>
                                    <Td className="font-mono text-xs text-muted">{it.urlSlug ?? "—"}</Td>
                                    <Td className="text-xs text-muted">{new Date(it.updatedAt).toISOString().slice(0, 10)}</Td>
                                </Tr>
                            ))}
                        </tbody>
                    </table>
                </TableFrame>
            )}
        </main>
    );
}
