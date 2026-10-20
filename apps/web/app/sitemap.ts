import type { MetadataRoute } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, listActiveProductSlugs, listCurrentSlugs } from "@onestarry/db";

export const dynamic = "force-dynamic";

const BASE = "https://onestarry.com";

/** 动态 sitemap：首页 + /products + 全部活跃商品 PDP + 类目页 + 品牌页。规模化时再迁到 jobs cron 预生成 → R2 分片 + 动态 index。 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const now = new Date();
    const products = await listActiveProductSlugs(db);
    const categories = await listCurrentSlugs(db, "category");
    const brands = await listCurrentSlugs(db, "brand");

    return [
        { url: `${BASE}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
        { url: `${BASE}/products`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
        { url: `${BASE}/categories`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
        { url: `${BASE}/brands`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
        ...products.map((p) => ({
            url: `${BASE}/products/${p.slug}`,
            lastModified: p.updatedAt ?? now,
            changeFrequency: "weekly" as const,
            priority: 0.8,
        })),
        ...categories.map((s) => ({
            url: `${BASE}/categories/${s}`,
            lastModified: now,
            changeFrequency: "weekly" as const,
            priority: 0.6,
        })),
        ...brands.map((s) => ({
            url: `${BASE}/brands/${s}`,
            lastModified: now,
            changeFrequency: "weekly" as const,
            priority: 0.6,
        })),
    ];
}
