import { config } from "dotenv";
config({ path: "../../.env.local" });

import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import { brands, categories, products, slugs } from "./schema";

/**
 * 目录结构 seed（浏览页演示用，幂等）：建最小类目/品牌 + 其 slug（slugs 表单一真源）+ 把 demo 商品挂上。
 * 已存在（按 slug 查）则复用、不重复插入。运行：pnpm --filter @onestarry/db seed:catalog
 */
const CATS = [
    { slug: "drinkware", name: "Drinkware" },
    { slug: "bags", name: "Bags & Totes" },
];
const BRANDS = [
    { slug: "stoneware-co", name: "Stoneware Co" },
    { slug: "trailkit", name: "Trailkit" },
];
// demo 商品 slug → 归属类目/品牌（按 slug 找商品，找不到的跳过）
const LINK: Record<string, { category: string; brand: string }> = {
    "ceramic-mug": { category: "drinkware", brand: "stoneware-co" },
    "steel-bottle": { category: "drinkware", brand: "trailkit" },
    "linen-tote": { category: "bags", brand: "trailkit" },
};

async function ensureEntity(
    db: ReturnType<typeof createDb>,
    entityType: "category" | "brand",
    slug: string,
    insert: () => Promise<string>,
): Promise<string> {
    const hit = (
        await db
            .select({ entityId: slugs.entityId })
            .from(slugs)
            .where(and(eq(slugs.entityType, entityType), eq(slugs.locale, "en"), eq(slugs.slug, slug)))
            .limit(1)
    )[0];
    if (hit) return hit.entityId;
    const id = await insert();
    await db.insert(slugs).values({ entityType, entityId: id, locale: "en", slug, isCurrent: true });
    return id;
}

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);

    const catIds: Record<string, string> = {};
    for (const c of CATS) {
        catIds[c.slug] = await ensureEntity(db, "category", c.slug, async () => {
            const [row] = await db.insert(categories).values({ name: c.name, level: 1, isLeaf: true }).returning({ id: categories.id });
            return row!.id;
        });
    }

    const brandIds: Record<string, string> = {};
    for (const b of BRANDS) {
        brandIds[b.slug] = await ensureEntity(db, "brand", b.slug, async () => {
            const [row] = await db.insert(brands).values({ name: b.name, slug: b.slug }).returning({ id: brands.id });
            return row!.id;
        });
    }

    let linked = 0;
    for (const [prodSlug, m] of Object.entries(LINK)) {
        const pid = (
            await db
                .select({ entityId: slugs.entityId })
                .from(slugs)
                .where(and(eq(slugs.entityType, "product"), eq(slugs.locale, "en"), eq(slugs.slug, prodSlug), eq(slugs.isCurrent, true)))
                .limit(1)
        )[0]?.entityId;
        if (!pid) {
            console.log(`↷ 商品 slug "${prodSlug}" 不存在，跳过挂载`);
            continue;
        }
        await db
            .update(products)
            .set({ primaryCategoryId: catIds[m.category], brandId: brandIds[m.brand], updatedAt: new Date() })
            .where(eq(products.id, pid));
        linked++;
    }

    console.log(`✅ 目录 seed 完成：类目 ${CATS.length}、品牌 ${BRANDS.length}、挂载商品 ${linked} 个`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
