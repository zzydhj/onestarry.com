import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
    createDb,
    emitEvent,
    fetchPendingEvents,
    transactionalOutbox,
    uuidv7,
    OUTBOX_MAX_ATTEMPTS,
} from "@onestarry/db";
import { relayHandlers, runRelayBatch, type RelayHandlers } from "./index";

/**
 * relay 重试 / 死信闭环冒烟（审查 H1 的真验证）：证明
 *   ① handler 抛错的失败事件会被「回队重试」，逐次 attempts+1，达阈值置 dead 且不再回队；
 *   ② 未注册 handler 的未知事件当场置 dead（而非旧写的静默 ack）。
 * 关键：用一个「只抛 JS 错、不碰 SQL」的 handler —— 真实 SQL 错误会 abort 整个事务，
 * 就没法在同一个 tx 里连跑多轮驱动 attempts 了。JS throw 不 abort，UPDATE(markFailed) 照常。
 * 全程一个事务，最后回滚，不留数据。运行：pnpm --filter @onestarry/jobs smoke:retry
 */
const ROLLBACK = Symbol("rollback");

/** 在 relayHandlers 基础上加一条必失败的 handler；真实 price.recompute 仍正常处理，不误伤现网事件。 */
const handlers: RelayHandlers = {
    ...relayHandlers,
    "test.failing": async () => {
        throw new Error("boom (forced failure for retry smoke)");
    },
};

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);

    const readEvent = async (tx: Parameters<typeof emitEvent>[0], aggId: string) =>
        (await tx.select().from(transactionalOutbox).where(eq(transactionalOutbox.aggregateId, aggId)))[0];

    try {
        await db.transaction(async (tx) => {
            const failAgg = uuidv7();
            const unknownAgg = uuidv7();
            await emitEvent(tx, { aggregateType: "test", aggregateId: failAgg, eventType: "test.failing", payload: {} });
            await emitEvent(tx, { aggregateType: "test", aggregateId: unknownAgg, eventType: "test.unknown", payload: {} });

            // 第一轮批量：同时处理未知事件（置 dead）与失败事件（第 1 次失败→attempts=1/failed）
            await runRelayBatch(tx, handlers, { limit: 500 });
            const unk = await readEvent(tx, unknownAgg);
            assert.equal(unk?.status, "dead", `未知事件应置 dead，实际 ${unk?.status}`);
            assert.equal(unk?.lastError, "no_handler");

            // ② 失败事件：首轮后应为 failed/attempts=1，且能被 fetchPendingEvents 重新拉回（回队生效，不是只拉 pending）
            let f = await readEvent(tx, failAgg);
            assert.equal(f?.status, "failed", `首轮失败后应停 failed，实际 ${f?.status}`);
            assert.equal(f?.attempts, 1, `首轮失败后 attempts 应为 1，实际 ${f?.attempts}`);
            const queued = await fetchPendingEvents(tx, 500);
            assert.ok(queued.some((e) => e.aggregateId === failAgg), "failed(attempts<阈值) 事件应被重新拉回队列");

            // 继续跑直到超阈置 dead（不依赖精确轮次，跑到 dead 为止）
            let guard = 0;
            while (f?.status !== "dead" && guard < OUTBOX_MAX_ATTEMPTS + 2) {
                await runRelayBatch(tx, handlers, { limit: 500 });
                f = await readEvent(tx, failAgg);
                guard++;
            }
            assert.equal(f?.status, "dead", `反复失败后应置 dead，实际 ${f?.status}`);
            assert.equal(f?.attempts, OUTBOX_MAX_ATTEMPTS, `attempts 应封顶在 ${OUTBOX_MAX_ATTEMPTS}，实际 ${f?.attempts}`);

            // dead 后不再回队
            const afterDead = await fetchPendingEvents(tx, 500);
            assert.ok(!afterDead.some((e) => e.aggregateId === failAgg), "dead 事件不应再进队列");

            console.log(
                `✅ H1 闭环：失败事件回队重试 attempts 1..${OUTBOX_MAX_ATTEMPTS} 后置 dead 并停止回队；未知事件当场置 dead（no_handler）`,
            );
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ RELAY RETRY SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
