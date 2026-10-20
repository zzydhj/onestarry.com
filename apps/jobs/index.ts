import { and, eq, sql } from "drizzle-orm";
import { createDb, runDataRetention, transactionalOutbox } from "@onestarry/db";
import { relayHandlers, runRelayBatch } from "@onestarry/jobs";

/** 每日数据保留清理的 cron 表达式（须与 wrangler.jsonc crons 中那条一致）。 */
const RETENTION_CRON = "20 4 * * *";

export interface Env {
    HYPERDRIVE: Hyperdrive;
    RELAY_BATCH_LIMIT?: string;
}

/**
 * Cloudflare Cron Trigger Worker：
 * - scheduled：每分钟消费 outbox 待办事件；每日一条 cron 跑数据保留清理（按 event.cron 分流）。
 * - fetch：只读健康端点，回 outbox 待办计数，用于验证 Worker↔Hyperdrive→Neon 连通。
 */
export default {
    async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        const db = createDb(env.HYPERDRIVE.connectionString);
        if (event.cron === RETENTION_CRON) {
            const r = await runDataRetention(db);
            console.log(`[retention] idempotencyKeys=${r.idempotencyKeys} outbox=${r.outbox} webhookEvents=${r.webhookEvents}`);
            return;
        }
        const limit = Number(env.RELAY_BATCH_LIMIT ?? "500");
        const summary = await runRelayBatch(db, relayHandlers, { limit });
        console.log(`[relay] processed=${summary.processed} ok=${summary.succeeded} fail=${summary.failed}`);
    },

    async fetch(req: Request, env: Env): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname !== "/health") return new Response("not found", { status: 404 });
        const db = createDb(env.HYPERDRIVE.connectionString);
        const rows = await db
            .select({ pending: sql<number>`count(*)::int` })
            .from(transactionalOutbox)
            .where(and(eq(transactionalOutbox.status, "pending")));
        return Response.json({ ok: true, service: "onestarry-jobs", pending: rows[0]?.pending ?? 0 });
    },
} satisfies ExportedHandler<Env>;
