import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import { seoMeta, slugs } from "./schema";
import { uuidv7 } from "./uuid7";
import { getBrandById, getCategoryById, getCategorySubtreeIds, getSeoMeta, loadBrandPageMeta, loadCategoryPageMeta, resolveSlug } from "./queries";

/**
 * 类目/品牌页合并查询的对照冒烟：把新的「一条 SQL」和旧的「四到五条串行」逐字段比。
 *
 * 断言点：① 三态判定一致（查无 slug / 历史 slug / 当前 slug）；② 子树 id 集合一致；
 * ③ SEO 键必须是 camelCase 且有值（raw 查询最容易在这里静默变成 snake_case）；
 * ④ 品牌页少一层子树但不能少 name/entityId。
 * redirect 分支线上数据里通常没有，所以在事务里造一条历史 slug 来验，验完强制回滚。
 * 运行：pnpm --filter @onestarry/db smoke:catalog-page
 */
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);

    const same = (a: string[], b: string[]) => assert.deepEqual([...a].sort(), [...b].sort(), "子树 id 集合必须一致");
    const seoEqual = (a: Awaited<ReturnType<typeof getSeoMeta>>, b: Awaited<ReturnType<typeof getSeoMeta>>) => {
        if (!a || !b) return assert.equal(a, b, "SEO 两边应同为空或同非空");
        for (const k of ["seoTitle", "metaDescription", "canonicalUrl", "robots", "og"] as const) {
            assert.deepEqual(b[k], a[k], `SEO.${k} 必须一致（raw 查询没映射列名时会在这里露出来）`);
        }
    };

    // —— 类目页 ——
    const catSlugs = (
        await db
            .select({ slug: slugs.slug, entityId: slugs.entityId })
            .from(slugs)
            .where(and(eq(slugs.entityType, "category"), eq(slugs.locale, "en"), eq(slugs.isCurrent, true)))
            .limit(3)
    );
    assert.ok(catSlugs.length > 0, "库里应至少有一个类目 slug");
    for (const c of catSlugs) {
        const old = await getCategoryById(db, c.entityId);
        const idsOld = await getCategorySubtreeIds(db, c.entityId);
        const seoOld = await getSeoMeta(db, { entityType: "category", entityId: c.entityId, locale: "en" });
        const meta = await loadCategoryPageMeta(db, { slug: c.slug });
        assert.equal(meta.status, "ok", `类目 ${c.slug} 应为 ok`);
        assert.equal(meta.name, old?.name, "name 必须等于 getCategoryById");
        assert.equal(meta.entityId, c.entityId);
        same(meta.categoryIds, idsOld);
        seoEqual(seoOld, meta.seo);
        console.log(`✅ 类目 ${c.slug}：${meta.name}，子树 ${meta.categoryIds.length} 个 id，SEO ${meta.seo ? "有" : "无"}`);
    }

    // —— 品牌页 ——
    const brandSlugs = (
        await db
            .select({ slug: slugs.slug, entityId: slugs.entityId })
            .from(slugs)
            .where(and(eq(slugs.entityType, "brand"), eq(slugs.locale, "en"), eq(slugs.isCurrent, true)))
            .limit(3)
    );
    assert.ok(brandSlugs.length > 0, "库里应至少有一个品牌 slug");
    for (const b of brandSlugs) {
        const old = await getBrandById(db, b.entityId);
        const seoOld = await getSeoMeta(db, { entityType: "brand", entityId: b.entityId, locale: "en" });
        const meta = await loadBrandPageMeta(db, { slug: b.slug });
        assert.equal(meta.status, "ok", `品牌 ${b.slug} 应为 ok`);
        assert.equal(meta.name, old?.name);
        assert.equal(meta.entityId, b.entityId);
        assert.deepEqual(meta.categoryIds, [], "品牌页不该带子树 id");
        seoEqual(seoOld, meta.seo);
        console.log(`✅ 品牌 ${b.slug}：${meta.name}，SEO ${meta.seo ? "有" : "无"}`);
    }

    // —— 查无此 slug ——
    const ghost = await loadCategoryPageMeta(db, { slug: "zz-not-a-category" });
    assert.equal(ghost.status, "notfound", "查无 slug 必须 notfound（前台靠它 404）");
    assert.deepEqual(ghost.categoryIds, []);
    console.log("✅ 未知 slug → notfound");

    // —— 历史 slug → redirect（事务里造数据，验完回滚） ——
    const target = catSlugs[0]!;
    const tmpSlug = `zz-smoke-${Date.now()}`;
    let rolledBack = false;
    try {
        await db.transaction(async (tx) => {
            await tx.insert(slugs).values({ id: uuidv7(), entityType: "category", entityId: target.entityId, locale: "en", slug: tmpSlug, isCurrent: false });
            const meta = await loadCategoryPageMeta(tx, { slug: tmpSlug });
            assert.equal(meta.status, "redirect", "历史 slug 必须判成 redirect");
            assert.equal(meta.toSlug, target.slug, "toSlug 必须是该实体的当前 slug");
            assert.deepEqual(meta.categoryIds, [], "redirect 时不该把子树算出来浪费");
            throw new Error("__rollback__");
        });
    } catch (e) {
        if ((e as Error).message !== "__rollback__") throw e;
        rolledBack = true;
    }
    assert.ok(rolledBack, "事务应已回滚");
    const after = await loadCategoryPageMeta(db, { slug: tmpSlug });
    assert.equal(after.status, "notfound", "回滚后临时 slug 不应残留");
    console.log(`✅ 历史 slug → redirect(toSlug=${target.slug})，且数据已回滚`);

    // —— SEO 覆盖必须是 camelCase（真库这两类实体通常没 seo_meta 行，不造一行就断言不到）——
    const brandTarget = brandSlugs[0]!;
    for (const [entityType, entityId, load] of [
        ["category", target.entityId, loadCategoryPageMeta] as const,
        ["brand", brandTarget.entityId, loadBrandPageMeta] as const,
    ]) {
        let done = false;
        try {
            await db.transaction(async (tx) => {
                await tx.insert(seoMeta).values({
                    id: uuidv7(),
                    entityType,
                    entityId,
                    locale: "en",
                    marketId: null,
                    seoTitle: "SMOKE 标题",
                    metaDescription: "SMOKE 描述",
                    canonicalUrl: "/smoke-canonical",
                    robots: { index: false },
                    og: { title: "SMOKE OG" },
                });
                const meta = await load(tx, { slug: entityType === "category" ? target.slug : brandTarget.slug });
                assert.equal(meta.status, "ok");
                assert.equal(meta.seo?.seoTitle, "SMOKE 标题", "seoTitle 必须是 camelCase 键（to_jsonb 会给 seo_title）");
                assert.equal(meta.seo?.metaDescription, "SMOKE 描述");
                assert.equal(meta.seo?.canonicalUrl, "/smoke-canonical");
                assert.deepEqual(meta.seo?.robots, { index: false });
                assert.deepEqual(meta.seo?.og, { title: "SMOKE OG" });
                seoEqual(await getSeoMeta(tx, { entityType, entityId, locale: "en" }), meta.seo);
                throw new Error("__rollback__");
            });
        } catch (e) {
            if ((e as Error).message !== "__rollback__") throw e;
            done = true;
        }
        assert.ok(done, `${entityType} 的 SEO 断言应已跑完并回滚`);
        const gone = await load(db, { slug: entityType === "category" ? target.slug : brandTarget.slug });
        assert.equal(gone.seo, null, "回滚后不应残留 SEO 覆盖");
        console.log(`✅ ${entityType} SEO 覆盖 camelCase 五个字段均一致，数据已回滚`);
    }

    // —— 与 resolveSlug 的三态完全对齐 ——
    for (const c of catSlugs) {
        const r = await resolveSlug(db, { entityType: "category", locale: "en", slug: c.slug });
        assert.equal(r?.status, "current");
    }
    console.log("✅ 当前 slug 的 resolveSlug 语义未变");

    console.log("\n✅ CATALOG PAGE SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
