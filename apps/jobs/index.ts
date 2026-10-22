import { and, eq, sql } from "drizzle-orm";
import { SITE_ORIGIN, readIsrHealthReport } from "@onestarry/core";
import { createDb, listActiveProductSlugs, runDataRetention, transactionalOutbox } from "@onestarry/db";
import { pruneStaleIsrCache, relayHandlers, runIsrProbe, runRelayBatch } from "@onestarry/jobs";

/** 每日数据保留清理的 cron 表达式（须与 wrangler.jsonc crons 中那条一致）。 */
const RETENTION_CRON = "20 4 * * *";
/** ISR 健康探针的 cron 表达式（须与 wrangler.jsonc crons 中那条一致）。 */
const ISR_CRON = "*/5 * * * *";

export interface Env {
    HYPERDRIVE: Hyperdrive;
    /** 前台 ISR 成品页桶（探针报告写这里 + 清理历史构建遗留条目）。 */
    ISR_CACHE: R2Bucket;
    RELAY_BATCH_LIMIT?: string;
    /** 探针额外采样几个商品详情页（除 / 与 /products 外）。默认 3。 */
    ISR_PROBE_SLUGS?: string;
}

/**
 * 跑一轮 ISR 探针（结论写进 R2，前台 /api/health 与后台运维面板共读）。
 *
 * 为什么要有这一步：缓存链路坏掉时不报错——200 照给、内容照对，只是每次都回源全额渲染，
 * 而 miss 本身永远合法，所以没有任何一层能告出「本该命中却没命中」。
 * 2026-10-22 商品页恒 STALE 的三周就是靠人工连打才发现的（取证过程见 docs/PERF.md）；
 * 这里把这个手法固化成定时测，断了十几分钟内就要可见。
 */
async function probeIsr(env: Env): Promise<void> {
    const db = createDb(env.HYPERDRIVE.connectionString);
    const take = Number(env.ISR_PROBE_SLUGS ?? "3");
    // 商品 slug 取失败不影响探针本身：静态路由照样能测出写回链路是否断。
    let slugs: Array<{ slug: string | null }> = [];
    try {
        slugs = await listActiveProductSlugs(db);
    } catch (e) {
        console.error("[isr] 取商品 slug 失败，本轮只测静态路由：", e);
    }
    const paths = ["/", "/products", ...slugs.slice(0, take).map((r) => `/products/${r.slug}`)];

    const report = await runIsrProbe(env.ISR_CACHE, { origin: SITE_ORIGIN, paths });
    const bad = report.findings
        .filter((f) => f.verdict !== "ok" && f.verdict !== "unknown")
        .map((f) => `${f.path}=${f.verdict}`)
        .join(" ");
    console.log(`[isr] verdict=${report.verdict} badStreak=${report.badStreak} ${bad || "全部命中"}`);
}

/**
 * Cloudflare Cron Trigger Worker：
 * - scheduled：每分钟消费 outbox 待办事件；每日一条 cron 跑数据保留清理 + 陈旧 ISR 条目清理；
 *   每 5 分钟一条 cron 跑 ISR 健康探针（按 event.cron 分流）。
 * - fetch：只读健康端点，回 outbox 待办计数 + 最近一次 ISR 探针结论，用于验证连通性与放量判别。
 */
export default {
    async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        if (event.cron === ISR_CRON) {
            await probeIsr(env);
            return;
        }
        const db = createDb(env.HYPERDRIVE.connectionString);
        if (event.cron === RETENTION_CRON) {
            const r = await runDataRetention(db);
            console.log(`[retention] idempotencyKeys=${r.idempotencyKeys} outbox=${r.outbox} webhookEvents=${r.webhookEvents}`);
            // 每次部署都换一个 buildId 前缀，旧构建的成品页没人删（线上实测积了 43 个前缀/571 个对象）。
            // 清理放在每日这一条里，不进 5 分钟那条：删除要避开刚部署完的窗口。
            const pruned = await pruneStaleIsrCache(env.ISR_CACHE);
            console.log(`[isr-prune] deadPrefixes=${pruned.prefixes} deleted=${pruned.objects}`);
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
        const isr = await readIsrHealthReport((key) => env.ISR_CACHE.get(key));
        return Response.json({
            ok: true,
            service: "onestarry-jobs",
            pending: rows[0]?.pending ?? 0,
            // 探针没跑过时为 null：监控上要把「没数据」和「健康」区分开
            isr: isr ? { verdict: isr.verdict, badStreak: isr.badStreak, checkedAt: isr.checkedAt } : null,
        });
    },
} satisfies ExportedHandler<Env>;
