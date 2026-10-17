import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { createDb } from "./client";
import { attributeDefinitions, categories, categoryAttributeSets, slugs } from "./schema";
import { getCategoryAttributes, listCategoryChildren, resolveSlug } from "./queries";

/**
 * catalog 查询助手冒烟：真实连 Neon，在一个事务里插入→读回→断言，最后强制回滚（不留测试数据）。
 * 运行：pnpm --filter @onestarry/db smoke:catalog
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置（先跑 neon env pull）");
    const db = createDb(url);
    const suffix = Date.now();
    const catName = `Smoke Cat ${suffix}`;
    const attrSlug = `smoke_color_${suffix}`;
    const catSlug = `smoke-cat-${suffix}`;

    try {
        await db.transaction(async (tx) => {
            const [cat] = await tx.insert(categories).values({ name: catName, level: 1, isLeaf: false }).returning();
            if (!cat) throw new Error("category insert 未返回行");

            const [attr] = await tx
                .insert(attributeDefinitions)
                .values({ slug: attrSlug, name: "Smoke Color", dataType: "select", options: ["red", "blue"], isFacet: true })
                .returning();
            if (!attr) throw new Error("attribute insert 未返回行");

            await tx.insert(categoryAttributeSets).values({ categoryId: cat.id, attributeId: attr.id, position: 1 });
            await tx.insert(slugs).values({ entityType: "category", entityId: cat.id, locale: "en", slug: catSlug, isCurrent: true });

            // 1) slug 解析：当前
            const resolved = await resolveSlug(tx, { entityType: "category", locale: "en", slug: catSlug });
            assert.ok(resolved, "resolveSlug 应命中");
            assert.equal(resolved?.status, "current");
            assert.equal((resolved as { entityId: string }).entityId, cat.id);

            // 2) slug 解析：历史 → redirect
            await tx.insert(slugs).values({ entityType: "category", entityId: cat.id, locale: "en", slug: `${catSlug}-old`, isCurrent: false });
            const hist = await resolveSlug(tx, { entityType: "category", locale: "en", slug: `${catSlug}-old` });
            assert.equal(hist?.status, "redirect");
            assert.equal((hist as { toSlug: string }).toSlug, catSlug);

            // 3) 动态属性读取
            const attrs = await getCategoryAttributes(tx, cat.id);
            assert.equal(attrs.length, 1);
            assert.equal(attrs[0]?.slug, attrSlug);
            assert.equal(attrs[0]?.isFacet, true);

            // 4) 顶层子类目包含新插入的
            const tops = await listCategoryChildren(tx, null);
            assert.ok(tops.some((c) => c.id === cat.id), "listCategoryChildren(null) 应含新顶层类目");

            console.log("✅ 断言全部通过：slug 解析(当前/历史) + 动态属性 + 类目树");
            throw ROLLBACK; // 强制回滚
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ CATALOG SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
