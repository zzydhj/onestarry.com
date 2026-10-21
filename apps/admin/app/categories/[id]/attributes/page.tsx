import Link from "next/link";
import { notFound } from "next/navigation";
import { createDb, getCategoryAttributes, getCategoryById, listAttributeDefinitions } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { Button, Select } from "@onestarry/ui";
import { attachCategoryAttributeAction, removeCategoryAttributeAction } from "./actions";

export const dynamic = "force-dynamic";

/** 类目属性配置（受保护）：把全局属性挂到本类目 / 解除。挂上的属性决定该类目商品可填哪些规格、将来可按哪些筛选。 */
export default async function CategoryAttributesPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { env } = await requirePermission(PERMISSIONS.categoryWrite);
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cat = await getCategoryById(db, id);
    if (!cat) notFound();
    const attached = await getCategoryAttributes(db, id);
    const allAttrs = await listAttributeDefinitions(db);
    const attachedIds = new Set(attached.map((a) => a.attributeId));
    const available = allAttrs.filter((a) => !attachedIds.has(a.id));

    return (
        <main className="mx-auto max-w-3xl px-4 py-8">
            <Link href="/categories" className="text-sm text-muted transition hover:text-accent">← 返回类目</Link>
            <h1 className="mt-2 text-xl font-semibold">{cat.name} · 属性 <span className="text-sm font-normal text-muted">（已挂 {attached.length}）</span></h1>

            <form action={attachCategoryAttributeAction} className="mt-5 flex flex-wrap items-center gap-2">
                <input type="hidden" name="categoryId" value={cat.id} />
                <Select name="attributeId" className="py-1.5 text-sm" disabled={available.length === 0}>
                    {available.length === 0 ? (
                        <option value="">（无可用属性，先去「属性」新建）</option>
                    ) : (
                        <>
                            <option value="">选择要挂载的属性…</option>
                            {available.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}（{a.slug}·{a.dataType}）</option>
                            ))}
                        </>
                    )}
                </Select>
                <Button type="submit" size="sm" disabled={available.length === 0}>挂载</Button>
            </form>

            {attached.length === 0 ? (
                <p className="mt-6 text-sm text-muted">本类目尚未挂载任何属性。</p>
            ) : (
                <ul className="mt-6 divide-y divide-line rounded-xl border border-line">
                    {attached.map((a) => (
                        <li key={a.attributeId} className="flex items-center justify-between gap-2 px-4 py-3">
                            <div className="min-w-0">
                                <span className="text-sm font-medium">{a.name}</span>
                                <span className="ml-2 font-mono text-xs text-muted">{a.slug}</span>
                                <span className="ml-2 text-xs text-muted">{a.dataType}</span>
                                {a.isFacet && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">可筛选</span>}
                                {a.isVariantOption && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">变体项</span>}
                            </div>
                            <form action={removeCategoryAttributeAction}>
                                <input type="hidden" name="categoryId" value={cat.id} />
                                <input type="hidden" name="attributeId" value={a.attributeId} />
                                <Button type="submit" variant="secondary" size="sm">解除</Button>
                            </form>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
