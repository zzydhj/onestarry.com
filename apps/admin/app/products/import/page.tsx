import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

/** 批量导入页（受保护）：上传 CSV，按 SKU upsert 商品。 */
export default async function ImportPage() {
    await requireAdmin();

    return (
        <main className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/products" className="text-sm text-muted transition hover:text-accent">← 返回商品列表</Link>
            <h1 className="mt-2 text-xl font-semibold">批量导入商品（CSV）</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
                第一行为表头。按 <code className="font-mono text-xs">sku</code> 匹配：存在则更新、不存在则新建。<br />
                列：<code className="font-mono text-xs">sku, slug, title, description, basePrice, cost, weight, onHand, status, imageUrl</code><br />
                价格/成本填美元（如 <code className="font-mono text-xs">19.99</code>），重量克，库存整数，status 取 <code className="font-mono text-xs">draft/active/archived</code>；<code className="font-mono text-xs">imageUrl</code> 会下载存进 R2 并挂为商品图；留空的列不改动。
            </p>
            <div className="mt-4">
                <ImportForm />
            </div>
        </main>
    );
}
