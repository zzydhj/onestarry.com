import type { Metadata } from "next";
import { listProductsForMarket } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { ProductGrid } from "@/components/ProductGrid";

// 整页 ISR（与 PDP 同级）：构建期用 CI 注入的 DATABASE_URL 预渲染真实首页存进 R2；
// 运行期每 60s 到期后首个访问秒回旧页 + 后台用 Hyperdrive 绑定刷新。
export const revalidate = 60;

export const metadata: Metadata = {
    title: { absolute: "onestarry — Shop quality goods, shipped worldwide" },
    description: "Browse our catalog of quality goods shipped worldwide from our own warehouse.",
    alternates: { canonical: "/" },
};

const SITE_JSONLD = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "onestarry",
    url: "https://onestarry.com",
    publisher: { "@type": "Organization", name: "onestarry", url: "https://onestarry.com" },
};

export default async function Home() {
    const items = await listProductsForMarket(getDb(), "us", "en");

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSONLD) }} />
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">Shop</h1>
            <ProductGrid items={items} />
        </div>
    );
}
