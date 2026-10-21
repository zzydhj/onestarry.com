import { createDb, listAttributeDefinitions } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { Button, Card, Input, Label, Select } from "@onestarry/ui";
import { createAttributeAction, updateAttributeAction } from "./actions";
import { DeleteAttribute } from "./DeleteAttribute";

export const dynamic = "force-dynamic";

const DATA_TYPES = [
    { v: "text", label: "文本 text" },
    { v: "number", label: "数字 number" },
    { v: "select", label: "单选 select" },
    { v: "multi_select", label: "多选 multi_select" },
    { v: "boolean", label: "是/否 boolean" },
    { v: "range", label: "区间 range" },
];

const checkCls = "h-4 w-4 accent-accent";

/** 属性管理（受保护）：全局属性库的新增 / 编辑 / 删除。 */
export default async function AttributesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    const { env } = await requirePermission(PERMISSIONS.configWrite);
    const { error } = await searchParams;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const attrs = await listAttributeDefinitions(db);

    return (
        <main className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">
                属性管理 <span className="text-sm font-normal text-muted">（{attrs.length}）</span>
            </h1>
            <p className="mt-1 text-sm text-muted">全局属性库：定义一次即可被类目/商品复用；slug 为稳定标识，创建后不可改。</p>
            {error === "duplicate" && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">slug 已存在，请换一个。</p>
            )}

            <Card className="mt-6 p-5">
                <form action={createAttributeAction} className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="c-slug">slug *</Label>
                        <Input id="c-slug" name="slug" required placeholder="color / size / material" className="mt-1 w-full" />
                    </div>
                    <div>
                        <Label htmlFor="c-name">显示名 *</Label>
                        <Input id="c-name" name="name" required placeholder="Color" className="mt-1 w-full" />
                    </div>
                    <div>
                        <Label htmlFor="c-type">数据类型</Label>
                        <Select id="c-type" name="dataType" defaultValue="text" className="mt-1 w-full">
                            {DATA_TYPES.map((d) => (
                                <option key={d.v} value={d.v}>{d.label}</option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="c-unit">单位（可选）</Label>
                        <Input id="c-unit" name="unit" placeholder="cm / ml / g" className="mt-1 w-full" />
                    </div>
                    <div className="sm:col-span-2">
                        <Label htmlFor="c-options">候选值（select / multi_select 用，逗号或换行分隔）</Label>
                        <Input id="c-options" name="options" placeholder="Red, Blue, Green" className="mt-1 w-full" />
                    </div>
                    <div className="flex flex-wrap gap-4 sm:col-span-2">
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isVariantOption" className={checkCls} /> 作为变体选项</label>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFacet" className={checkCls} /> 参与筛选（facet）</label>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isRequired" className={checkCls} /> 必填</label>
                    </div>
                    <div className="sm:col-span-2">
                        <Button type="submit">新增属性</Button>
                    </div>
                </form>
            </Card>

            {attrs.length === 0 ? (
                <p className="mt-6 text-sm text-muted">还没有属性，用上方表单新增第一个。</p>
            ) : (
                <div className="mt-6 space-y-4">
                    {attrs.map((a) => {
                        const options = Array.isArray(a.options) ? (a.options as string[]).join(", ") : "";
                        return (
                            <Card key={a.id} className="p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <code className="rounded bg-surface px-2 py-0.5 font-mono text-xs">{a.slug}</code>
                                    <span className="text-xs text-muted">
                                        {a.dataType}
                                        {a.unit ? ` · ${a.unit}` : ""}
                                        {a.isVariantOption ? " · 变体" : ""}
                                        {a.isFacet ? " · 筛选" : ""}
                                        {a.isRequired ? " · 必填" : ""}
                                    </span>
                                </div>
                                <form action={updateAttributeAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <input type="hidden" name="id" value={a.id} />
                                    <div>
                                        <Label htmlFor={`name-${a.id}`}>显示名</Label>
                                        <Input id={`name-${a.id}`} name="name" defaultValue={a.name} className="mt-1 w-full" />
                                    </div>
                                    <div>
                                        <Label htmlFor={`type-${a.id}`}>数据类型</Label>
                                        <Select id={`type-${a.id}`} name="dataType" defaultValue={a.dataType} className="mt-1 w-full">
                                            {DATA_TYPES.map((d) => (
                                                <option key={d.v} value={d.v}>{d.label}</option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div>
                                        <Label htmlFor={`unit-${a.id}`}>单位</Label>
                                        <Input id={`unit-${a.id}`} name="unit" defaultValue={a.unit ?? ""} className="mt-1 w-full" />
                                    </div>
                                    <div>
                                        <Label htmlFor={`opts-${a.id}`}>候选值（逗号分隔）</Label>
                                        <Input id={`opts-${a.id}`} name="options" defaultValue={options} className="mt-1 w-full" />
                                    </div>
                                    <div className="flex flex-wrap gap-4 sm:col-span-2">
                                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isVariantOption" defaultChecked={a.isVariantOption} className={checkCls} /> 变体选项</label>
                                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFacet" defaultChecked={a.isFacet} className={checkCls} /> 筛选</label>
                                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isRequired" defaultChecked={a.isRequired} className={checkCls} /> 必填</label>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <Button type="submit" size="sm">保存</Button>
                                    </div>
                                </form>
                                <div className="mt-3 flex justify-end border-t border-line pt-3">
                                    <DeleteAttribute id={a.id} slug={a.slug} />
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </main>
    );
}
