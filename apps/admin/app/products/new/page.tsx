import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";

const inputCls = "w-full rounded-md border border-line px-3 py-2 text-sm";
const labelCls = "mt-3 block text-sm text-muted";

/** 新建商品表单（受保护）。提交 → createProductAction → 成功跳详情。 */
export default async function NewProduct({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    await requireAdmin();
    const { error } = await searchParams;

    return (
        <main className="mx-auto max-w-lg px-4 py-8">
            <Link href="/products" className="text-sm text-muted transition hover:text-accent">← 返回商品列表</Link>
            <h1 className="mt-2 text-xl font-semibold">新建商品</h1>
            {error === "duplicate" && <p className="mt-3 text-sm text-red-600">SKU 或 Slug 已存在，请换一个。</p>}
            {error === "invalid" && <p className="mt-3 text-sm text-red-600">请至少填写 SKU、标题、有效价格。</p>}

            <form action={createProductAction} className="mt-2">
                <label className={labelCls}>SKU *</label>
                <input name="sku" required className={inputCls} placeholder="如 MY-TSHIRT-BLK-M" />

                <label className={labelCls}>标题 *</label>
                <input name="title" required className={inputCls} placeholder="商品名称（英文）" />

                <label className={labelCls}>Slug（留空按标题自动生成）</label>
                <input name="slug" className={inputCls} placeholder="my-tshirt-blk-m" />

                <label className={labelCls}>描述</label>
                <textarea name="description" rows={3} className={inputCls} />

                <label className={labelCls}>基价 USD *</label>
                <input name="price" type="number" step="0.01" min="0" required className={inputCls} placeholder="19.99" />

                <label className={labelCls}>成本 USD（可选）</label>
                <input name="cost" type="number" step="0.01" min="0" className={inputCls} />

                <label className={labelCls}>重量 g（可选）</label>
                <input name="weight" type="number" min="0" step="1" className={inputCls} />

                <label className={labelCls}>库存 on_hand</label>
                <input name="onHand" type="number" min="0" step="1" defaultValue={0} className={inputCls} />

                <label className={labelCls}>上架状态</label>
                <select name="status" defaultValue="draft" className={inputCls}>
                    <option value="draft">草稿（下架）</option>
                    <option value="active">立即上架</option>
                </select>

                <button type="submit" className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
                    创建商品
                </button>
            </form>
        </main>
    );
}
