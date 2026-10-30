import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { idempotencyKeys, transactionalOutbox, webhookEvents } from "../schema";
import type { Db, Tx } from "../client";

/**
 * 数据保留清理（架构 §11 数据保留策略 / §15.1 计划 5b）。只删「已过临时窗口」的行，
 * 幂等可反复跑，绝不碰业务主数据、账本/库存只追加表、Better Auth 会话表。
 * 例外：webhook 的「证据行」过窗也不删（见下方 L6 注）——它们的保留口径与凭证一致，不是临时数据。
 * 由 jobs Worker 每日 cron 触发（见 apps/jobs）。app_rw 对这三张表有 DELETE 权（仅 ledger/stock 被 REVOKE）。
 */
export interface RetentionResult {
    idempotencyKeys: number;
    outbox: number;
    webhookEvents: number;
    /**
     * 已过窗口但因带审计价值而**被留下**的 webhook 事件行数（审查 L6）。
     * 豁免不能变成看不见的积压：这个数字得每天在 jobs 日志里看得见，否则“不删”会悄悄长成没人查的大表。
     */
    webhookEvidenceHeld: number;
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
    //
    // ⚠ 但「status='failed' 或 error 非空」的行过窗也不删（审查 L6，2026-10-29）。
    // 这类行是「钱到了但没落账」在库里**唯一**的留痕：正向落账成功会留下 payments + 账本分录（那才是真凭证，
    // 本函数根本不碰），而 ORDER_UNRESOLVED / PAYMENT_CURRENCY_MISMATCH / ORDER_CANCELLED / DUPLICATE_REPLAY /
    // UNASSOCIATED 这些分支的业务事务要么回滚要么刻意没写，event 行是它们存世的唯一记录 —— 90 天后一删，
    // 对账时看到的就是“什么都没发生过”。error 为空的 processed / ignored（PSP 的 PENDING、未知类型刷屏）照旧清掉。
    // 增长有界吗：`(provider, provider_event_id)` 唯一 ⇒ 每个 PSP 事件最多一行，异常事件本就应是少数；
    // 真大面积长起来是事故（靠 webhookEvidenceHeld 在日志里显形后人去修），而不是靠删数据把它藏起来。
    const webhookCutoff = new Date(now.getTime() - webhookKeepDays * DAY);
    // NULL 陷阱：写成 `not(or(eq(status,'failed'), isNotNull(error)))` 时，error 为 NULL 的行整个谓词求值为 NULL
    // ⇒ 一行都删不掉（幂等键/outbox 都在删、webhook 却静默零删除）。所以这里用**正向条件**表达“无留证”。
    const webhook = await drain((limit) =>
        db
            .delete(webhookEvents)
            .where(
                inArray(
                    webhookEvents.id,
                    db
                        .select({ id: webhookEvents.id })
                        .from(webhookEvents)
                        .where(and(lt(webhookEvents.createdAt, webhookCutoff), ne(webhookEvents.status, "failed"), isNull(webhookEvents.error)))
                        .limit(limit),
                ),
            )
            .returning({ id: webhookEvents.id }),
    );

    // 过窗但被豁免下来的证据行：只数不删，给运维一个可见量。
    // 这条谓词是上面删除条件的**补集**，两处口径必须对着读才能确认没交集。
    const held = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(webhookEvents)
        .where(and(lt(webhookEvents.createdAt, webhookCutoff), or(eq(webhookEvents.status, "failed"), isNotNull(webhookEvents.error))));

    return {
        idempotencyKeys: idem.deleted,
        outbox: outbox.deleted,
        webhookEvents: webhook.deleted,
        webhookEvidenceHeld: Number(held[0]?.n ?? 0),
        capped: idem.capped || outbox.capped || webhook.capped,
    };
}
