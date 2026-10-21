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

/** outbox 健康快照（后台运维面板用）：一次聚合查询，不拉行。 */
export interface OutboxHealth {
    pending: number;
    failed: number;
    dead: number;
    /** 最老的待办事件发生时间（pending 积压越久越小说明 relay 卡住） */
    oldestPendingAt: Date | null;
    /** 最近一次成功派发时间（relay 心跳的代理指标） */
    lastDispatchedAt: Date | null;
}

/**
 * 读 outbox 健康快照（只读，供后台「运维」卡使用）。
 * 用 Postgres 的 `FILTER` 一次算完各状态计数，避免多次往返。
 * ⚠️ 聚合表达式（min/max）经 postgres-js 返回的是**文本而非 Date**（已连库实测），
 *    故不能直接标 sql<Date>，必须过 toDate 归一 —— 否则调用方 .getTime() 会运行时报错。
 */
function toDate(v: unknown): Date | null {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === "string" && v.length > 0) {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

export async function getOutboxHealth(db: Db | Tx): Promise<OutboxHealth> {
    const rows = await db
        .select({
            pending: sql<number>`count(*) filter (where ${transactionalOutbox.status} = 'pending')::int`,
            failed: sql<number>`count(*) filter (where ${transactionalOutbox.status} = 'failed')::int`,
            dead: sql<number>`count(*) filter (where ${transactionalOutbox.status} = 'dead')::int`,
            oldestPendingAt: sql<unknown>`min(${transactionalOutbox.occurredAt}) filter (where ${transactionalOutbox.status} = 'pending')`,
            lastDispatchedAt: sql<unknown>`max(${transactionalOutbox.dispatchedAt})`,
        })
        .from(transactionalOutbox);
    const r = rows[0] ?? { pending: 0, failed: 0, dead: 0, oldestPendingAt: null, lastDispatchedAt: null };
    return {
        pending: r.pending ?? 0,
        failed: r.failed ?? 0,
        dead: r.dead ?? 0,
        oldestPendingAt: toDate(r.oldestPendingAt),
        lastDispatchedAt: toDate(r.lastDispatchedAt),
    };
}
