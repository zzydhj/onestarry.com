import {
    ISR_REPORT_KEY,
    classifyIsrSamples,
    isrVerdictNeedsAction,
    parseSMaxAge,
    worstIsrVerdict,
    type IsrHealthReport,
    type IsrSample,
    type IsrUrlFinding,
} from "@onestarry/core";

/**
 * ISR 健康探针（带 IO 的部分；判定规则在 @onestarry/core 的纯函数里，可单测）。
 *
 * 为什么要主动测：缓存链路坏掉时不报错——200 照给、内容照对，只是每次都回源全额渲染，
 * 而且「一次 miss」本身永远合法，所以链路上没有任何一层能产出「本该命中却没命中」这个信号。
 * 本站 2026-10-22 就是靠这套探针的同一手法在线上取证出问题的（过程见 docs/PERF.md）。
 *
 * 手法（与人工取证的判据一致）：
 *   1) 先打一次，把后台刷新触发起来（这一发的结果不参与判定，它本来就可能陈旧）；
 *   2) 等足够久让「入队 → DO 刷新 → 写回 R2」落地。默认 30 秒，**别再调回 12 秒**：
 *      单条暖路径实测 ~6 秒，但探针一轮并发暖 5 条，刷新要排队 + 冷 Neon 首连，
 *      实测能到 26 秒以上 —— 12 秒的旧节奏把这种慢读成了 never_hits（连续 24 轮误报）；
 *   3) 再复查两发（间隔 8 秒）。HIT 之前的 STALE 不算病，HIT 之后退回非 HIT 才算（规则见 core/isr.ts）。
 *   从不 HIT = never_hits；HIT 后退回 = oscillating；其余 = ok。
 */

/** 探针只需要这几个桶操作，用结构类型声明，避免这个包依赖 worker 全局类型。 */
export interface IsrCacheStore {
    get(key: string): Promise<{ json<T = unknown>(): Promise<T> } | null>;
    put(key: string, value: string): Promise<unknown>;
    list(opts?: {
        prefix?: string;
        cursor?: string;
        limit?: number;
    }): Promise<{ objects: Array<{ key: string; uploaded: Date }>; truncated?: boolean; cursor?: string }>;
    delete(key: string): Promise<unknown>;
}

export interface IsrProbeOptions {
    /** 站点根地址，如 https://onestarry.com（不带结尾斜杠）。 */
    origin: string;
    /** 要采样的路径，如 ["/", "/products", "/products/linen-tote"]。 */
    paths: readonly string[];
    /** 页面配置的 revalidate 秒数，仅随报告一起存下来供人对照。默认 60。 */
    revalidateSec?: number;
    /** 触发后等多久再复查（要覆盖「入队 → DO 刷新 → 写回 R2」）。默认 30000ms，并被夹到新鲜度窗口内。 */
    settleMs?: number;
    /** 复查几发（两发才能识别振荡）。默认 2。 */
    followUps?: number;
    /** 复查之间的间隔。默认 8000ms（最后一发要落在 revalidate 窗口里，见下面 maxSettleMs）。 */
    followUpGapMs?: number;
    /** 注入等待以便测试/替换。默认 setTimeout。 */
    wait?: (ms: number) => Promise<void>;
    /** 注入时钟以便测试。默认 Date.now。 */
    now?: () => number;
}

/** 只为在 wrangler tail / 访问日志里一眼认出探针流量。⚠ 它**不是**缓存豁免手段，见下面 probeUrl。 */
const UA = "onestarry-isr-probe";

/**
 * 每一发都挂一个一次性 query 参数，用来 bust 掉 Workers Cache（apps/web/wrangler.jsonc 的 cache.enabled）。
 * 这层缓存没有 UA 豁免，只认「响应头 + 缓存键」；而探针的职责就是「触发源站刷新 + 读源站的
 * x-nextjs-cache」—— 一旦被边缘接住，R2 条目会变冷，而且它读到的是缓存体里的旧头 → verdict 自此失真。
 *
 * 两边键的口径刚好不同，所以这一招只 bust 边缘、不 bust 源站：
 * 边缘缓存键含完整 query string → 每发唯一 → 必然 MISS；而 Next 的 ISR 键只看页面**实际读取**的
 * searchParams（实测 /products?market=us&page=2 直接复用 /products 那份条目）→ 仍打在同一个源站条目上。
 */
function probeUrl(origin: string, path: string, nonce: number, offsetMs: number): string {
    const sep = path.includes("?") ? "&" : "?";
    return `${origin}${path}${sep}probe=${nonce}-${offsetMs}`;
}

async function sampleOnce(url: string, offsetMs: number): Promise<IsrSample> {
    try {
        const res = await fetch(url, {
            headers: { "user-agent": UA },
            // 探针要测的是边缘真实链路，不能被本地缓存短路
            cache: "no-store",
            redirect: "manual",
        });
        return {
            offsetMs,
            status: res.status,
            cache: res.headers.get("x-nextjs-cache"),
            sMaxAge: parseSMaxAge(res.headers.get("cache-control")),
        };
    } catch {
        // 请求本身失败：记 0 让判定归到 error，而不是假装"没命中"
        return { offsetMs, status: 0, cache: null, sMaxAge: null };
    }
}

/**
 * 跑一轮探针并把结论写进 R2（`ISR_REPORT_KEY`），返回该轮报告。
 * 各路径的采样按「轮次」并行推进（同一时刻打所有路径），整轮耗时 ≈ settle + 复查间隔，不随路径数线性增长。
 */
export async function runIsrProbe(store: IsrCacheStore, opts: IsrProbeOptions): Promise<IsrHealthReport> {
    const revalidateSec = opts.revalidateSec ?? 60;
    const followUps = Math.max(1, opts.followUps ?? 2);
    const gapMs = opts.followUpGapMs ?? 8_000;
    /**
     * 复查必须全部落在新鲜度窗口内：新副本写好后要能撑到最后一发，否则会把
     * 「窗口正常到点」误读成退回非 HIT（本次误报的另一半成因）。留 5 秒收尾余量，
     * 并把 settle 自动夹进窗口：将来 revalidate 调小时不需要记得改这里。
     */
    const maxSettleMs = Math.max(5_000, revalidateSec * 1000 - followUps * gapMs - 5_000);
    const settleMs = Math.min(opts.settleMs ?? 30_000, maxSettleMs);
    const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = opts.now ?? (() => Date.now());

    const started = now();
    const perPath = new Map<string, IsrSample[]>();
    for (const p of opts.paths) perPath.set(p, []);

    // 第 0 发是「触发刷新」；后续每发之前都要等，等待只在轮次之间发生一次。
    const nonce = started; // 每轮探针一个，保证边缘缓存键不跟上一轮/别的部署碰撞
    for (let round = 0; round <= followUps; round++) {
        if (round === 1) await wait(settleMs);
        if (round > 1) await wait(gapMs);
        const offsetMs = now() - started;
        await Promise.all(
            [...perPath.keys()].map(async (path) => {
                perPath.get(path)!.push(await sampleOnce(probeUrl(opts.origin, path, nonce, offsetMs), offsetMs));
            }),
        );
    }

    const findings: IsrUrlFinding[] = [...perPath.entries()].map(([path, samples]) =>
        classifyIsrSamples(path, samples),
    );
    const verdict = worstIsrVerdict(findings);

    // 读上一轮的连续异常计数：抖动一轮不报警，连续两轮才认定异常（探针自身也可能被部署中的短暂抖动干扰）。
    const prev = await store.get(ISR_REPORT_KEY).then((o) => (o ? o.json<IsrHealthReport>() : null)).catch(() => null);
    const badStreak = isrVerdictNeedsAction(verdict) ? (prev?.badStreak ?? 0) + 1 : 0;

    const report: IsrHealthReport = {
        checkedAt: new Date(now()).toISOString(),
        revalidateSec,
        verdict,
        badStreak,
        findings,
    };
    await store.put(ISR_REPORT_KEY, JSON.stringify(report));
    return report;
}

export interface IsrPruneOptions {
    /** 距最后一次写入超过这么久就认定该构建已退役（线上构建会持续写入，留足余量）。默认 2 小时。 */
    deadBuildAfterMs?: number;
    /** 对象至少要老于这么久才删：给分批放量/回滚留出窗口，别把还在接流量的版本删了。默认 48 小时。 */
    keepRecentMs?: number;
    now?: () => number;
}

export interface IsrPruneResult {
    prefixes: number;
    objects: number;
    /** 被判定已退役的 buildId（写日志用，不写进报告：数量可能很大）。 */
    deadPrefixes: string[];
}

const CACHE_PREFIX = "incremental-cache";

/**
 * 清掉历史构建遗留的 ISR 条目。
 *
 * 为什么需要：R2 的 key 形如 `incremental-cache/<buildId>/<sha256>.cache`，**每次部署都换 buildId，
 * 旧构建的条目没人删** —— 2026-10-22 线上实测桶里堆了 43 个 buildId 前缀、571 个对象（每次部署 9~26 个）。
 * 既是白烧的存储，也让排障时先要分辨「哪个前缀才是现在这个版本」。
 *
 * 判定「已退役」用两条独立保险，宁可漏删也不错删：
 *   ① 该 buildId 下所有对象的最后写入时间早于 deadBuildAfterMs（活构建每分钟都在被刷新，绝不可能这么老）；
 *   ② 只删对象本身也老于 keepRecentMs 的（覆盖分批放量 / 刚回滚回去的场景）。
 * `_ops/` 下的报告不在此前缀内，不会被误删。
 */
export async function pruneStaleIsrCache(store: IsrCacheStore, opts: IsrPruneOptions = {}): Promise<IsrPruneResult> {
    const deadAfter = opts.deadBuildAfterMs ?? 2 * 60 * 60_000;
    const keepRecent = opts.keepRecentMs ?? 48 * 60 * 60_000;
    const now = (opts.now ?? (() => Date.now()))();

    // 全量列举（分页），按 buildId 归组记录该组最新的写入时间
    const newestByBuild = new Map<string, number>();
    const objects: Array<{ key: string; buildId: string; uploadedMs: number }> = [];
    let cursor: string | undefined;
    for (; ;) {
        const page = await store.list({ prefix: `${CACHE_PREFIX}/`, cursor, limit: 1000 });
        for (const o of page.objects ?? []) {
            const parts = o.key.split("/");
            const buildId = parts[1] ?? "";
            if (!buildId) continue;
            const uploadedMs = o.uploaded instanceof Date ? o.uploaded.getTime() : Number.NaN;
            objects.push({ key: o.key, buildId, uploadedMs });
            const seen = newestByBuild.get(buildId);
            if (seen === undefined || (!Number.isNaN(uploadedMs) && uploadedMs > seen)) newestByBuild.set(buildId, uploadedMs);
        }
        if (!page.truncated || !page.cursor) break;
        cursor = page.cursor;
    }

    const deadPrefixes = [...newestByBuild.entries()]
        .filter(([buildId, ms]) => buildId && (Number.isNaN(ms) || now - ms > deadAfter))
        .map(([buildId]) => buildId);
    const dead = new Set(deadPrefixes);

    let deleted = 0;
    for (const o of objects) {
        if (!dead.has(o.buildId)) continue;
        if (Number.isNaN(o.uploadedMs) || now - o.uploadedMs < keepRecent) continue;
        await store.delete(o.key);
        deleted++;
    }
    return { prefixes: dead.size, objects: deleted, deadPrefixes };
}
