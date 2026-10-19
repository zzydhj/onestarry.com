import type { MetadataRoute } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, listActiveProductSlugs } from "@onestarry/db";

export const dynamic = "force-dynamic";

const BASE = "https://onestarry.com";

/** 动态 sitemap：首页 + 全部活跃商品 PDP。规模化时再迁到 jobs cron 预生成 → R2 分片 + 动态 index。 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const now = new Date();
    const products = await listActiveProductSlugs(db);

    return [
        { url: `${BASE}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
        ...products.map((p) => ({
            url: `${BASE}/products/${p.slug}`,
            lastModified: p.updatedAt ?? now,
            changeFrequency: "weekly" as const,
            priority: 0.8,
        })),
    ];
}
