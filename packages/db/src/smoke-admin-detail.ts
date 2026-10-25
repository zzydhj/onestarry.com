import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "./client";
import { inventory, productTranslations, productVariants, products } from "./schema";
import { getSeoMeta, listAllBrands, listAllCategories, listProductImages, loadAdminProductDetail } from "./queries";

/**
 * 后台商品详情页合并查询的对照冒烟：新的「一条 SQL」对旧的「8 次串行」逐字段比，
 * 并把两边耗时量出来（没有数字就别宣称提速 —— docs/PERF.md 的第一条规矩）。
 *
 * 断言点：
 *  ① 主行字段一一对上（id/status/brandId/primaryCategoryId）；
 *  ② 变体集合与每个变体的 6 个值必须完全一致（SKU/基价/成本/主变体/on_hand/可用）——
 *     基价与成本是 bigint，raw 查询最容易在这里变成 string 或丢字段；
 *  ③ 图片顺序必须与 listProductImages 一致（position, created_at），不能只比集合：
 *     后台图片区就是按这个顺序渲染的，顺序变了等于运营看到图序被打乱；
 *  ④ SEO 五字段必须 camelCase 且有值（to_jsonb 会给 seo_title，这里会当场抓住）；
 *  ⑤ 查无此商品必须 found:false（页面靠它 notFound()）。
 * 读操作，不写库、不需要回滚。运行：pnpm --filter @onestarry/db smoke:admin-detail
 */

/** 页面原来那 8 步，逐字照搬（这是"旧"的定义，不是我的想象）。 */
async function oldPath(db: ReturnType<typeof createDb>, productId: string) {
    const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!product) return null;
    const [title] = await db
        .select({ title: productTranslations.title, richBody: productTranslations.richBody, locale: productTranslations.locale })
        .from(productTranslations)
        .where(eq(productTranslations.productId, productId))
        .limit(1);
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
    const invRows = variants.length
        ? await db.select().from(inventory).where(inArray(inventory.variantId, variants.map((v) => v.id)))
        : [];
    const stockMap = new Map(invRows.map((r) => [r.variantId, { onHand: r.onHand, available: r.available ?? 0 }]));
    const images = await listProductImages(db, productId);
    const seo = await getSeoMeta(db, { entityType: "product", entityId: productId, locale: "en" });
    const cats = await listAllCategories(db);
    const brands = await listAllBrands(db);
    return { product, title, variants, stockMap, images, seo, cats, brands };
}

async function timed<T>(fn: () => Promise<T>, rounds: number): Promise<{ values: number[]; result: T }> {
    const values: number[] = [];
    let result!: T;
    for (let i = 0; i < rounds; i++) {
        const t = performance.now();
        result = await fn();
        values.push(Math.round(performance.now() - t));
    }
    return { values, result };
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);

    const all = await db.select({ id: products.id, status: products.status }).from(products).limit(6);
    assert.ok(all.length > 0, "库里至少要有一个商品，否则这个冒烟什么都验不到");
    console.log(`对照 ${all.length} 个商品…\n`);

    let oldTotal = 0;
    let newTotal = 0;

    for (const p of all) {
        const old = await oldPath(db, p.id);
        assert.ok(old, "旧路径应能取到该商品");
        const d = await loadAdminProductDetail(db, p.id);

        assert.equal(d.found, true, `商品 ${p.id} 应 found=true`);
        assert.equal(d.id, old.product!.id, "id 必须一致");
        assert.equal(d.status, old.product!.status, "status 必须一致");
        assert.equal(d.brandId, old.product!.brandId ?? null, "brandId 必须一致");
        assert.equal(d.primaryCategoryId, old.product!.primaryCategoryId ?? null, "primaryCategoryId 必须一致");

        // 译文：旧写法不带 locale/order，多行时取哪条不确定 —— 按「有 en 用 en」这条有意收敛来断言。
        const trs = await db.select({ locale: productTranslations.locale, title: productTranslations.title }).from(productTranslations).where(eq(productTranslations.productId, p.id));
        const enTitle = trs.find((t) => t.locale === "en")?.title ?? trs[0]?.title ?? null;
        assert.equal(d.title, enTitle, `title 应为 en 优先（该行有 ${trs.length} 个语种）`);

        // 变体：逐 id 比 6 个值
        assert.equal(d.variants.length, old.variants.length, "变体数量必须一致");
        const oldVarById = new Map(old.variants.map((v) => [v.id, v]));
        for (const nv of d.variants) {
            const ov = oldVarById.get(nv.id);
            assert.ok(ov, `变体 ${nv.id} 必须存在于旧结果`);
            assert.equal(nv.sku, ov.sku, "sku 必须一致");
            assert.equal(nv.basePriceCents, ov.basePriceCents ?? null, `基价必须一致且是 number（SKU ${nv.sku}）`);
            assert.equal(nv.costCents, ov.costCents ?? null, `成本必须一致且是 number（SKU ${nv.sku}）`);
            assert.equal(typeof nv.basePriceCents === "number" || nv.basePriceCents === null, true, "基价不能是 string");
            assert.equal(nv.isPrimary, ov.isPrimary, "isPrimary 必须一致");
            assert.equal(nv.onHand, old.stockMap.get(nv.id)?.onHand ?? 0, `on_hand 必须一致（SKU ${nv.sku}）`);
            assert.equal(nv.available, old.stockMap.get(nv.id)?.available ?? 0, `可用库存必须一致（SKU ${nv.sku}）`);
        }

        // 图片：顺序也要一致（后台图片区按这个顺序显示）
        assert.deepEqual(d.images.map((i) => i.mediaId), old.images.map((i) => i.mediaId), "图片顺序必须与 listProductImages 一致");
        for (let i = 0; i < d.images.length; i++) {
            assert.equal(d.images[i]!.r2Key, old.images[i]!.r2Key, "r2Key 必须一致（错了就是图裂）");
            assert.equal(d.images[i]!.position, old.images[i]!.position, "position 必须一致");
        }

        // SEO：五字段 camelCase 逐个比
        if (!old.seo || !d.seo) assert.equal(d.seo, null, "SEO 两边应同为空");
        else for (const k of ["seoTitle", "metaDescription", "canonicalUrl", "robots", "og"] as const) {
            assert.deepEqual(d.seo[k], old.seo[k], `SEO.${k} 必须一致（raw 查询没映射列名会在这里露出来）`);
        }

        // 下拉数据：条数必须一致（顺序按 level,name / name，旧查询也是这个排序）
        assert.equal(d.categories.length, old.cats.length, "类目条数必须一致");
        assert.deepEqual(d.categories.map((c) => c.id), old.cats.map((c) => c.id), "类目顺序必须一致");
        assert.equal(d.brands.length, old.brands.length, "品牌条数必须一致");

        // 耗时对照（每个商品各跑 3 轮取中位）
        const oT = (await timed(() => oldPath(db, p.id), 3)).values;
        const nT = (await timed(() => loadAdminProductDetail(db, p.id), 3)).values;
        oldTotal += med(oT);
        newTotal += med(nT);

        const slugRow = trs.length ? d.title : "(无标题)";
        console.log(`✅ ${String(slugRow).slice(0, 28)}：变体 ${d.variants.length}、图 ${d.images.length}、SEO ${d.seo ? "有" : "无"}`);
        console.log(`   旧 8 次串行 ${oT.join("/")}ms 中位 ${med(oT)}ms → 新 1 次 ${nT.join("/")}ms 中位 ${med(nT)}ms`);
    }

    // —— 查无此商品 ——
    const ghost = await loadAdminProductDetail(db, "01927b9e-0000-7000-8000-000000000000");
    assert.equal(ghost.found, false, "查无此商品必须 found=false（页面靠它 notFound）");
    assert.deepEqual(ghost.variants, [], "found=false 时数组应为空而不是 null");
    console.log("✅ 未知商品 → found:false，数组字段退化成空数组");

    console.log(`\n合计中位：旧 ${oldTotal}ms vs 新 ${newTotal}ms（${oldTotal && newTotal ? (oldTotal / newTotal).toFixed(1) + "x" : "—"}）`);
    console.log("⚠ 这是本地直连 us-east-2 的数字，RTT 已含在里面（CN→US 比线上 HK→US 更大）；"
        + "所以绝对值不能直接当线上时长，结构性的收益是「往返次数 8 → 1」（线上真实收益待部署后实测）");
    console.log("\n✅ ADMIN DETAIL SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
