import { and, eq, lt } from "drizzle-orm";
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
}

const DAY = 86_400_000;

export async function runDataRetention(
    db: Db | Tx,
    opts: { outboxKeepDays?: number; webhookKeepDays?: number } = {},
): Promise<RetentionResult> {
    const now = new Date();
    const outboxKeepDays = opts.outboxKeepDays ?? 90;
    const webhookKeepDays = opts.webhookKeepDays ?? 90;

    // 幂等键：expires_at 已过 → 删（本就是临时防重锁）。
    const idem = await db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expiresAt, now))
        .returning({ id: idempotencyKeys.id });

    // Outbox：仅删已 dispatched 且超过保留窗口的历史（pending/failed/dead 留着给 relay 重试/排查）。
    const outbox = await db
        .delete(transactionalOutbox)
        .where(
            and(
                eq(transactionalOutbox.status, "dispatched"),
                lt(transactionalOutbox.occurredAt, new Date(now.getTime() - outboxKeepDays * DAY)),
            ),
        )
        .returning({ id: transactionalOutbox.id });

    // Webhook 接收记录：幂等窗口（唯一约束防重放）过后，超期历史删除。
    const webhook = await db
        .delete(webhookEvents)
        .where(lt(webhookEvents.createdAt, new Date(now.getTime() - webhookKeepDays * DAY)))
        .returning({ id: webhookEvents.id });

    return { idempotencyKeys: idem.length, outbox: outbox.length, webhookEvents: webhook.length };
}
