import {
    transactionalOutbox,
    fetchPendingEvents,
    markDispatched,
    markFailed,
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
 * 失败逐条 markFailed（attempts+1，留待下次重试或超阈值置 dead）。
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
            ackIds.push(ev.id); // 未知类型：确认丢弃，避免堵队（事件类型由我们自控）
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
