import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "./client";
import { seoMeta } from "./schema";
import { upsertSeoMeta } from "./queries";

/**
 * seo_meta 并发去重冒烟（审查 M-10 的真验证）：证明 COALESCE(market_id, 零值) 表达式唯一索引
 * 对「语言级回退行」（marketId=NULL）真的生效——旧的可空列唯一索引对 NULL 不约束，
 * 旧"先查后插"的 upsert 在并发下会插出两行、getSeoMeta limit(1) 随机取 → 改了没生效。
 * 断言两件事：① 同 scope 连做两次 upsert 只剩 1 行且是后一次的值（ON CONFLICT DO UPDATE 命中）；
 * ② 绕过 upsert 直接插第二条同 scope NULL 行 → 被 23505 拒。全程一事务，最后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:seo
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const entityId = crypto.randomUUID();
    const scope = and(eq(seoMeta.entityType, "product"), eq(seoMeta.entityId, entityId), eq(seoMeta.locale, "en"), isNull(seoMeta.marketId));

    try {
        await db.transaction(async (tx) => {
            // 第一次 upsert（插入）。
            await upsertSeoMeta(tx, { entityType: "product", entityId, locale: "en", seoTitle: "A", metaDescription: null, canonicalUrl: null, robots: null, og: null });
            // 第二次 upsert（应命中 ON CONFLICT → 更新，不是插第二行）。
            await upsertSeoMeta(tx, { entityType: "product", entityId, locale: "en", seoTitle: "B", metaDescription: "d", canonicalUrl: null, robots: null, og: null });

            const rows = await tx.select({ id: seoMeta.id, seoTitle: seoMeta.seoTitle }).from(seoMeta).where(scope);
            assert.equal(rows.length, 1, `两次 upsert 后同 scope 只应 1 行（ON CONFLICT 生效），实际 ${rows.length} 行`);
            assert.equal(rows[0]?.seoTitle, "B", "应保留最后一次写入的值");
            console.log(`✅ M-10：两次 upsert 收敛成 1 行、值取最近（${rows[0]?.seoTitle}）`);

            // 绕过 upsert 直插第二条同 scope 的 NULL-market 行 → 必须被表达式唯一索引拒（模拟并发里的第二个 INSERT）。
            // 23505 会 abort 事务，故这是本事务最后一步断言。
            let violated = false;
            let info = "";
            try {
                await tx.insert(seoMeta).values({ entityType: "product", entityId, locale: "en", marketId: null, seoTitle: "dup" });
            } catch (e) {
                violated = true;
                const anyErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
                info = `code=${anyErr.code ?? anyErr.cause?.code ?? ""} constraint=${anyErr.constraint ?? anyErr.cause?.constraint ?? ""}`;
            }
            assert.ok(violated, `同 scope 第二条 NULL 行必须被唯一索引拒掉（否则 M-10 未生效）：${info}`);
            assert.ok(info.includes("23505") || /seo_entity_locale_market_uq/i.test(info), `应因 seo_entity_locale_market_uq 拒掉，实际：${info}`);
            console.log(`✅ M-10：直插第二行被表达式唯一索引拒（${info}）`);

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ SEO SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
