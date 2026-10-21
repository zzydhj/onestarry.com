import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ImportForm } from "./ImportForm";
import { UrlImportForm } from "./UrlImportForm";

export const dynamic = "force-dynamic";

/** 批量导入页（受保护）：上传 CSV，按 SKU upsert 商品。 */
export default async function ImportPage() {
    await requireAdmin();

    return (
        <main className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/products" className="text-sm text-muted transition hover:text-accent">← 返回商品列表</Link>
            <h1 className="mt-2 text-xl font-semibold">导入商品</h1>
            <section className="mt-4">
                <h2 className="text-sm font-semibold">按产品链接导入（自动抓取）</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                    粘贴商品页链接，自动抓取标题/描述/价格/图片（图片转存你的 R2）并生成草稿，供审核发布。Shopify / 品牌站 / 多数普通网站可直接抓；淘宝/1688 需专用 API（暂未接）。
                </p>
                <div className="mt-3">
                    <UrlImportForm />
                </div>
            </section>
            <h2 className="mt-8 text-sm font-semibold">批量导入（CSV）</h2>
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
