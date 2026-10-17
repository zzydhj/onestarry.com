/**
 * schema/outbox.ts —— Transactional Outbox（§15 步骤 10 / §3 铁律④）
 *
 * 业务写事务内追加一行事件，与主写同事务提交 → 保证"改了数据必有事件"（不丢）。
 * relay（Inngest 或 Cloudflare Queues+Cron，消费侧后续选）轮询 status=pending 派发到
 * Typesense 同步 / revalidateTag(PDP) / 价格重算 / 邮件 等，成功置 dispatched。
 * 至少一次投递；下游按 aggregateId+eventType 幂等消费。
 */
import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";

export const transactionalOutbox = pgTable(
    "transactional_outbox",
    {
        ...timestamps(),
        id: id(),
        aggregateType: text("aggregate_type").notNull(), // product | variant | price | inventory | order | content ...
        aggregateId: uuid("aggregate_id").notNull(),
        eventType: text("event_type").notNull(), // price.recompute | search.index | inventory.changed | order.paid ...
        payload: jsonb("payload").notNull().$type<Record<string, unknown>>().default({}),
        status: text("status").notNull().default("pending"), // pending | dispatched | failed | dead
        attempts: integer("attempts").notNull().default(0),
        occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
        dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
        lastError: text("last_error"),
    },
    (t) => [
        index("outbox_status_occurred_idx").on(t.status, t.occurredAt),
        index("outbox_aggregate_idx").on(t.aggregateType, t.aggregateId),
    ],
);
