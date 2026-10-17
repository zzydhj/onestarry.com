import { createDb } from "@onestarry/db";
import { relayHandlers, runRelayBatch } from "@onestarry/jobs";

export interface Env {
    HYPERDRIVE: Hyperdrive;
    RELAY_BATCH_LIMIT?: string;
}

/**
 * Cloudflare Cron Trigger Worker：每分钟被唤醒一次，消费 outbox 待办事件。
 * 与触发方式解耦——runRelayBatch 也可被"写时自派发"或将来 Queues 消费者调用。
 */
export default {
    async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        const db = createDb(env.HYPERDRIVE.connectionString);
        const limit = Number(env.RELAY_BATCH_LIMIT ?? "500");
        const summary = await runRelayBatch(db, relayHandlers, { limit });
        console.log(`[relay] processed=${summary.processed} ok=${summary.succeeded} fail=${summary.failed}`);
    },
} satisfies ExportedHandler<Env>;
