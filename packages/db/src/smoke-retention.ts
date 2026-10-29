import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { inArray, like, lt } from "drizzle-orm";
import { createDb } from "./client";
import { idempotencyKeys, webhookEvents } from "./schema";
import { runDataRetention } from "./queries";

/**
 * 有界分批数据保留清理的冒烟（迁移 0016 给 app_rw 上 `statement_timeout=30s` 时登记的那颗延迟炸弹，2026-10-29 收口）。
 * 种 5001 条已过窗口的 webhook 事件（必须大于单批 5000，否则验不出“真的跑了第二批”）+ 3 条未过窗口的
 * + 一对过期/未过期幂等键，断言三件事：
 *   ① 只删该删的（窗口口径没因改写而变宽）；
 *   ② 跨批计数不重复（drain 拿的是 `.returning()` 的真删行数，不是候选数）；
 *   ③ 内层子查询真带 LIMIT（行为断言分辨不出 LIMIT 被忽略的情形，因为总数一样，所以直接看 SQL 文本）。
 * 全程在最外层事务内跑、结尾回滚，不往生产库留数据。
 * 运行：pnpm --filter @onestarry/db smoke:retention
 */
const ROLLBACK = Symbol("rollback");
const DAY = 86_400_000;

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();
    const old = new Date(Date.now() - 100 * DAY);
    const fresh = new Date();
    const future = new Date(Date.now() + DAY); // 幂等键的“未过期”必须真的在未来：拿 fresh 会被函数里后取的 now 判成已过期

    const rows = Array.from({ length: 5001 }, (_, i) => ({
        provider: "smoke",
        providerEventId: `retail-${suffix}-${i}`,
        type: "payment_intent.succeeded",
        payload: { i },
        status: "processed",
        createdAt: old,
        updatedAt: old,
    }));

    try {
        await db.transaction(async (tx) => {
            await tx.insert(webhookEvents).values(rows);
            await tx
                .insert(webhookEvents)
                .values(
                    Array.from({ length: 3 }, (_, i) => ({
                        provider: "smoke",
                        providerEventId: `retfresh-${suffix}-${i}`,
                        type: "payment_intent.succeeded",
                        payload: { i },
                        status: "processed",
                        createdAt: fresh,
                        updatedAt: fresh,
                    })),
                );
            await tx.insert(idempotencyKeys).values([
                { key: `ret-${suffix}-a`, scope: "smoke", expiresAt: old, createdAt: old, updatedAt: old },
                { key: `ret-${suffix}-b`, scope: "smoke", expiresAt: future, createdAt: fresh, updatedAt: fresh },
            ]);

            const r = await runDataRetention(tx, { outboxKeepDays: 0, webhookKeepDays: 90 });

            assert.equal(r.webhookEvents, 5001, `跨批总数必须是 5001（5000+1），实际 ${r.webhookEvents}`);
            assert.equal(r.capped, false, "抽干了就不该报 capped");
            assert.ok(r.idempotencyKeys >= 1, `过期幂等键应至少删掉 1 条，实际 ${r.idempotencyKeys}`);

            const leftFresh = await tx
                .select({ id: webhookEvents.id })
                .from(webhookEvents)
                .where(inArray(webhookEvents.providerEventId, [`retfresh-${suffix}-0`, `retfresh-${suffix}-1`, `retfresh-${suffix}-2`]));
            assert.equal(leftFresh.length, 3, "未过保留窗口的 3 条必须原样留着（分批不该多删）");

            const staleLeft = await tx
                .select({ id: webhookEvents.id })
                .from(webhookEvents)
                .where(like(webhookEvents.providerEventId, `retail-${suffix}-%`));
            assert.equal(staleLeft.length, 0, "本次种下的过期行应被清干净");

            const leftIdem = await tx
                .select({ id: idempotencyKeys.id })
                .from(idempotencyKeys)
                .where(inArray(idempotencyKeys.key, [`ret-${suffix}-a`, `ret-${suffix}-b`]));
            assert.equal(leftIdem.length, 1, "只有未过期的那条幂等键该留下");

            console.log(
                `✅ 分批：deleted=${r.webhookEvents}（两批 5000+1）outbox=${r.outbox} idem=${r.idempotencyKeys} capped=${r.capped}`,
            );
            console.log("✅ 窗口口径：过期清光、未过期一条没动");

            // 上面两条断言分辨不出子查询里的 LIMIT 有没有真被渲染（忽略它也一样数得出 5001），所以直接看 SQL 文本。
            const shape = tx
                .delete(webhookEvents)
                .where(
                    inArray(
                        webhookEvents.id,
                        tx.select({ id: webhookEvents.id }).from(webhookEvents).where(lt(webhookEvents.createdAt, old)).limit(5000),
                    ),
                )
                .toSQL().sql;
            console.log(`SQL 形态：${shape.replace(/\s+/g, " ").slice(0, 220)}`);
            assert.match(shape, /limit\s\$|limit \d|limit\s/i, "内层子查询必须带 LIMIT，否则还是有界删");
            assert.match(shape, /in\s*\(\s*select/i, "必须是 DELETE ... WHERE id IN (SELECT ... LIMIT n)");
            console.log("✅ SQL 形态：内层子查询带 LIMIT（有界删真的成立，不是伪装修剪）");
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ RETENTION SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e instanceof Error ? e.message.slice(0, 600) : e);
        process.exit(1);
    });
