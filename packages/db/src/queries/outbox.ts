import { eq, inArray, sql } from "drizzle-orm";
import { transactionalOutbox } from "../schema";
import type { Db, Tx } from "../client";

export interface OutboxEventInput {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload?: object;
}

/**
 * 在业务事务内追加一条 outbox 事件（与主写同事务，保证不丢）。
 * 用法：await db.transaction(async (tx) => { ...主写...; await emitEvent(tx, {...}); });
 */
export async function emitEvent(db: Db | Tx, e: OutboxEventInput): Promise<void> {
    await db.insert(transactionalOutbox).values({
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        eventType: e.eventType,
        payload: (e.payload ?? {}) as Record<string, unknown>,
    });
}

/** relay 拉取待派发事件（按发生时间先进先出）。 */
export async function fetchPendingEvents(db: Db | Tx, limit = 50) {
    return db
        .select()
        .from(transactionalOutbox)
        .where(eq(transactionalOutbox.status, "pending"))
        .orderBy(transactionalOutbox.occurredAt)
        .limit(limit);
}

/** 派发成功 → 标记 dispatched。 */
export async function markDispatched(db: Db | Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db
        .update(transactionalOutbox)
        .set({ status: "dispatched", dispatchedAt: new Date() })
        .where(inArray(transactionalOutbox.id, ids));
}

/** 派发失败 → 记 attempts+1 与错误；超过阈值由 relay 置 dead。 */
export async function markFailed(db: Db | Tx, id: string, error: string): Promise<void> {
    await db
        .update(transactionalOutbox)
        .set({ status: "failed", lastError: error, attempts: sql`${transactionalOutbox.attempts} + 1` })
        .where(eq(transactionalOutbox.id, id));
}
