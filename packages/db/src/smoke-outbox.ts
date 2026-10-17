import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { createDb } from "./client";
import { uuidv7 } from "./uuid7";
import { emitEvent, fetchPendingEvents, markDispatched } from "./queries";

/**
 * outbox 写侧冒烟：事务内 emit→fetchPending→markDispatched，验证状态流转，最后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:outbox
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const aggId = uuidv7(); // 唯一聚合 id，便于从共享 outbox 中隔离本次事件

    try {
        await db.transaction(async (tx) => {
            await emitEvent(tx, { aggregateType: "variant", aggregateId: aggId, eventType: "price.recompute", payload: { market: "de" } });
            await emitEvent(tx, { aggregateType: "variant", aggregateId: aggId, eventType: "search.index", payload: {} });

            const mine = (await fetchPendingEvents(tx, 200)).filter((e) => e.aggregateId === aggId);
            assert.equal(mine.length, 2, "应拉到刚写入的 2 条 pending");

            const first = mine[0]!;
            await markDispatched(tx, [first.id]);

            const stillPending = (await fetchPendingEvents(tx, 200)).filter((e) => e.aggregateId === aggId);
            assert.equal(stillPending.length, 1, "派发后只剩 1 条 pending");
            assert.notEqual(stillPending[0]?.id, first.id);

            console.log("✅ outbox：emit → fetchPending → markDispatched 状态流转正确");
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ OUTBOX SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
