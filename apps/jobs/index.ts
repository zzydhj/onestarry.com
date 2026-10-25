import { and, eq, sql } from "drizzle-orm";
import { SITE_ORIGIN, ADMIN_ORIGIN, readIsrHealthReport } from "@onestarry/core";
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
 * 后台 Worker 保活：发一发 `/signin`（真页面、不查库、不需登录）。
 *
 * 为什么要：2026-10-25 线上实测，后台闲置后的第一发要 2.9–3.8s，而热起来只跟 0.7–1.0s；
 * 拆开看是 **冷 isolate 的模块编译被计进 cpuTime**（冷 340–1003ms vs 热 28–106ms），
 * 不是缓存未命中。密集刷新时那些冷启动还会撞 CPU 上限 → 503。保活同时消掉这三个。
 * 代价：每 5 分钟 1 个请求 = 288/天（免费额度 10 万/天的 0.3%），不引入新计费项。
 *
 * ⚠ 两个已知边界（别把这块当保证）：
 *  · Workers isolate 是**按 colo** 的，cron 这一发落在哪个 PoP 不由我们定，
 *    不保证就是用户浏览器那个 —— 所以这是“大概率变热”，不是“必然不冷”。
 *  · 预热的是共享的服务端 bundle；路由自己的 chunk 未必被拉起来。上线后要拿真实“静置后首发”复量，
 *    没效果就删（取证口径见 docs/PERF.md §2）。
 */
async function keepWarmAdmin(): Promise<void> {
    try {
        const res = await fetch(`${ADMIN_ORIGIN}/signin`, {
            headers: { "user-agent": "onestarry-keepwarm" },
            redirect: "manual",
        });
        if (!res.ok && res.status !== 307 && res.status !== 308) {
            console.warn(`[keepwarm] admin /signin 回了 ${res.status}`);
        }
    } catch (e) {
        // 保活失败不影响探针，也不该把整条 cron 带红：下一轮还会再试。
        console.warn("[keepwarm] admin 保活请求失败：", e);
    }
}

/**
 * Cloudflare Cron Trigger Worker：
 * - scheduled：每分钟消费 outbox 待办事件；每日一条 cron 跑数据保留清理 + 陈旧 ISR 条目清理；
 *   每 5 分钟一条 cron 跑 ISR 健康探针（按 event.cron 分流），顺带保活后台 Worker。
 * - fetch：只读健康端点，回 outbox 待办计数 + 最近一次 ISR 探针结论，用于验证连通性与放量判别。
 */
export default {
    async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
        if (event.cron === ISR_CRON) {
            await probeIsr(env);
            ctx.waitUntil(keepWarmAdmin());
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
