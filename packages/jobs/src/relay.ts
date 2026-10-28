import {
    transactionalOutbox,
    fetchPendingEvents,
    markDispatched,
    markFailed,
    markDead,
    type Db,
    type Tx,
} from "@onestarry/db";

export type OutboxRow = typeof transactionalOutbox.$inferSelect;
export type RelayHandler = (db: Db | Tx, event: OutboxRow) => Promise<void>;
/** eventType → 处理器。新增事件类型只往这里注册，不改引擎。 */
export type RelayHandlers = Record<string, RelayHandler>;

export interface RelaySummary {
    processed: number;
    succeeded: number;
    failed: number;
}

/**
 * 消费一批 outbox 待办：按 eventType 找处理器执行，成功批量标记 dispatched，
 * 失败逐条 markFailed（attempts+1，下次重拉；超阈由 markFailed 置 dead）。
 * 未注册 handler 的未知事件 → markDead（审查 H1）：旧写法直接 ack 会把它当“已处理”抹掉，
 * 使 order.created / order.shipped 等“发了事件但无人消费”的配置缺口永远看不见。
 * 由 Cloudflare Cron（每分钟）和/或写时自派发调用；与触发方式解耦。
 */
export async function runRelayBatch(
    db: Db | Tx,
    handlers: RelayHandlers,
    opts: { limit?: number } = {},
): Promise<RelaySummary> {
    const events = await fetchPendingEvents(db, opts.limit ?? 50);
    const ackIds: string[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const ev of events) {
        const handler = handlers[ev.eventType];
        if (!handler) {
            // 未知类型：置 dead 而非 ack，让 dead 计数在 /health 与后台运维卡上显形。
            await markDead(db, ev.id, "no_handler");
            failed++;
            continue;
        }
        try {
            await handler(db, ev);
            ackIds.push(ev.id);
            succeeded++;
        } catch (e) {
            await markFailed(db, ev.id, e instanceof Error ? e.message : String(e));
            failed++;
        }
    }

    await markDispatched(db, ackIds);
    return { processed: events.length, succeeded, failed };
}
