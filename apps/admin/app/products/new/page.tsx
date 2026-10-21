import Link from "next/link";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { Button, Input, Label, Select, Textarea } from "@onestarry/ui";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";

/** 新建商品表单（受保护）。提交 → createProductAction → 成功跳详情。 */
export default async function NewProduct({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    await requirePermission(PERMISSIONS.productWrite);
    const { error } = await searchParams;

    return (
        <main className="mx-auto max-w-lg px-4 py-8">
            <Link href="/products" className="text-sm text-muted transition hover:text-accent">← 返回商品列表</Link>
            <h1 className="mt-2 text-xl font-semibold">新建商品</h1>
            {error === "duplicate" && <p className="mt-3 text-sm text-red-600">SKU 或 Slug 已存在，请换一个。</p>}
            {error === "invalid" && <p className="mt-3 text-sm text-red-600">请至少填写 SKU、标题、有效价格。</p>}

            <form action={createProductAction} className="mt-2 grid">
                <Label className="mt-3" htmlFor="sku">SKU *</Label>
                <Input id="sku" name="sku" required placeholder="如 MY-TSHIRT-BLK-M" />

                <Label className="mt-3" htmlFor="title">标题 *</Label>
                <Input id="title" name="title" required placeholder="商品名称（英文）" />

                <Label className="mt-3" htmlFor="slug">Slug（留空按标题自动生成）</Label>
                <Input id="slug" name="slug" placeholder="my-tshirt-blk-m" />

                <Label className="mt-3" htmlFor="description">描述</Label>
                <Textarea id="description" name="description" rows={3} />

                <Label className="mt-3" htmlFor="price">基价 USD *</Label>
                <Input id="price" name="price" type="number" step="0.01" min="0" required placeholder="19.99" />

                <Label className="mt-3" htmlFor="cost">成本 USD（可选）</Label>
                <Input id="cost" name="cost" type="number" step="0.01" min="0" />

                <Label className="mt-3" htmlFor="weight">重量 g（可选）</Label>
                <Input id="weight" name="weight" type="number" min="0" step="1" />

                <Label className="mt-3" htmlFor="onHand">库存 on_hand</Label>
                <Input id="onHand" name="onHand" type="number" min="0" step="1" defaultValue={0} />

                <Label className="mt-3" htmlFor="status">上架状态</Label>
                <Select id="status" name="status" defaultValue="draft">
                    <option value="draft">草稿（下架）</option>
                    <option value="active">立即上架</option>
                </Select>

                <Button type="submit" className="mt-6">创建商品</Button>
            </form>
        </main>
    );
}
