import { and, eq, inArray, lt } from "drizzle-orm";
import { idempotencyKeys, transactionalOutbox, webhookEvents } from "../schema";
import type { Db, Tx } from "../client";

/**
 * 数据保留清理（架构 §11 数据保留策略 / §15.1 计划 5b）。只删「已过临时窗口」的行，
 * 幂等可反复跑，绝不碰业务主数据、账本/库存只追加表、Better Auth 会话表。
 * 由 jobs Worker 每日 cron 触发（见 apps/jobs）。app_rw 对这三张表有 DELETE 权（仅 ledger/stock 被 REVOKE）。
 */
export interface RetentionResult {
    idempotencyKeys: number;
    outbox: number;
    webhookEvents: number;
    /** 至少一张表抵达了本次运行的批数上界 ⇒ 还有积压，明天接着删（这就是幂等的意义）。 */
    capped: boolean;
}

const DAY = 86_400_000;

/**
 * 单批删除行数上限。
 * 为什么必须有界：`app_rw` 现在带着 `statement_timeout = 30s`（迁移 0016），旧的无界
 * `DELETE ... RETURNING` 在积压长大会**整条被杀** ⇒ 清理天天失败、三张临时表无限增长（而且比不删更卡），
 * 而不是“慢一点”。分批后每条语句都在百毫秒量级完成，失败只丢一批，锁与 WAL 也不会在一条语句上越积越多。
 */
const BATCH_ROWS = 5000;
/** 单次运行每张表最多跑几批：给一次 cron 一个上界，别让它长时间占着那唯一一条连接（Workers 也有 CPU/墙钟顶）。 */
const MAX_BATCHES = 20;

/**
 * 批间循环：Postgres 没有 `DELETE ... LIMIT`，只能 `WHERE id IN (SELECT ... LIMIT n)`。
 * `run` 必须返回**本次真删掉的行**（`.returning()`），而不是候选数，否则并发跑时会把同一批算两次。
 */
async function drain(
    run: (limit: number) => Promise<{ id: string }[]>,
): Promise<{ deleted: number; capped: boolean }> {
    let deleted = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
        const rows = await run(BATCH_ROWS);
        deleted += rows.length;
        if (rows.length < BATCH_ROWS) return { deleted, capped: false }; // 不满一批 = 已抽干
    }
    return { deleted, capped: true };
}

export async function runDataRetention(
    db: Db | Tx,
    opts: { outboxKeepDays?: number; webhookKeepDays?: number } = {},
): Promise<RetentionResult> {
    const now = new Date();
    const outboxKeepDays = opts.outboxKeepDays ?? 90;
    const webhookKeepDays = opts.webhookKeepDays ?? 90;

    // 幂等键：expires_at 已过 → 删（本就是临时防重锁）。
    const idem = await drain((limit) =>
        db
            .delete(idempotencyKeys)
            .where(
                inArray(
                    idempotencyKeys.id,
                    db
                        .select({ id: idempotencyKeys.id })
                        .from(idempotencyKeys)
                        .where(lt(idempotencyKeys.expiresAt, now))
                        .limit(limit),
                ),
            )
            .returning({ id: idempotencyKeys.id }),
    );

    // Outbox：仅删已 dispatched 且超过保留窗口的历史（pending/failed/dead 留着给 relay 重试/排查）。
    const outbox = await drain((limit) =>
        db
            .delete(transactionalOutbox)
            .where(
                inArray(
                    transactionalOutbox.id,
                    db
                        .select({ id: transactionalOutbox.id })
                        .from(transactionalOutbox)
                        .where(
                            and(
                                eq(transactionalOutbox.status, "dispatched"),
                                lt(transactionalOutbox.occurredAt, new Date(now.getTime() - outboxKeepDays * DAY)),
                            ),
                        )
                        .limit(limit),
                ),
            )
            .returning({ id: transactionalOutbox.id }),
    );

    // Webhook 接收记录：幂等窗口（唯一约束防重放）过后，超期历史删除。
    const webhook = await drain((limit) =>
        db
            .delete(webhookEvents)
            .where(
                inArray(
                    webhookEvents.id,
                    db
                        .select({ id: webhookEvents.id })
                        .from(webhookEvents)
                        .where(lt(webhookEvents.createdAt, new Date(now.getTime() - webhookKeepDays * DAY)))
                        .limit(limit),
                ),
            )
            .returning({ id: webhookEvents.id }),
    );

    return {
        idempotencyKeys: idem.deleted,
        outbox: outbox.deleted,
        webhookEvents: webhook.deleted,
        capped: idem.capped || outbox.capped || webhook.capped,
    };
}
