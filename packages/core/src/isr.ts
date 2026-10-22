/**
 * ISR 边缘缓存健康判定（纯函数，可单测；带 IO 的探针在 @onestarry/jobs）。
 *
 * **为什么必须由我们自己写这个断言**：整条 ISR 链路（Next 渲染 → R2 写回 → DO 队列 → 后台刷新）
 * 坏掉时是不报错的——200 照给、内容照对，只是每次都回源做全额渲染。链路上任何一层都产不出
 * 「本该命中却没命中」这个信号（miss 永远是合法的，没有哪层能判定你"应该"命中），
 * 所以这个性质只能外部主动测量：触发一次刷新，给它足够时间落地，再复查。
 *
 * 判读基线（2026-10-22 线上取证，过程见 docs/PERF.md）：
 * - HIT 时 `Cache-Control: s-maxage=N` 里的 N 是**剩余新鲜度倒计时**，不是固定等于 revalidate；
 *   只有刚刷完的第一秒才看得到接近满值，之后逐秒递减——「s-maxage 从 60 变成 47」不是回归。
 * - STALE 时 OpenNext 的 `fixISRHeaders()` 会强制改写成 `s-maxage=2, stale-while-revalidate=2592000`
 *   （为 CloudFront SWR 设计的行为，不是配置错误）。原响应头里没有 s-maxage 时该函数直接 return，
 *   于是响应**完全没有 Cache-Control**——CDN 一份都不留，每个访客都回源。
 * - 真故障的形状只有两种：触发刷新后复查仍从不翻 HIT（`never_hits`）；
 *   或同一 colo 内逐请求 HIT/STALE 交替（`oscillating`，= 条目年龄存在两套真值在互相打脸）。
 */

/** 探针结论。严重度顺序见 ISR_VERDICT_SEVERITY（error 最重、ok 最轻）。 */
export type IsrVerdict =
    /** 复查全部命中：链路健康 */
    | "ok"
    /** 复查里既有 HIT 又有 STALE：缓存窗口在塌陷（双时钟/条目污染的特征） */
    | "oscillating"
    /** 复查从不 HIT：后台刷新没写回，或写回的条目被判即时过期 */
    | "never_hits"
    /** 复查全都没有 x-nextjs-cache 头：该路由已经不是 ISR 页（配置被改动） */
    | "not_isr"
    /** 请求失败 / 5xx：探针本身跑不通，结论不可信 */
    | "error"
    /** 样本不足，无法判定 */
    | "unknown";

export const ISR_VERDICT_LABELS: Record<IsrVerdict, string> = {
    ok: "缓存正常",
    oscillating: "命中不稳定",
    never_hits: "从不命中",
    not_isr: "未走 ISR",
    error: "探针失败",
    unknown: "样本不足",
};

const ISR_VERDICT_SEVERITY: Record<IsrVerdict, number> = {
    ok: 0,
    unknown: 1,
    oscillating: 2,
    not_isr: 3,
    never_hits: 4,
    error: 5,
};

/** 单次采样的事实（只取响应头，不解析 HTML）。 */
export interface IsrSample {
    /** 距本轮探针开始的毫秒数；判定时只用车程顺序，第一个样本是「触发刷新」那一次。 */
    readonly offsetMs: number;
    /** HTTP 状态；请求抛异常时记 0。 */
    readonly status: number;
    /** `x-nextjs-cache`（HIT/STALE/MISS/REVALIDATED）；头缺失为 null。 */
    readonly cache: string | null;
    /** 从 `Cache-Control` 解析出的 s-maxage；缺失为 null。 */
    readonly sMaxAge: number | null;
}

export interface IsrUrlFinding {
    readonly path: string;
    readonly samples: readonly IsrSample[];
    readonly verdict: IsrVerdict;
}

/** jobs 每轮探针写进 R2 的报告；web 的 /api/health 与后台运维面板共读这一份。 */
export interface IsrHealthReport {
    /** 本轮采样时间（ISO）。 */
    readonly checkedAt: string;
    /** 判定所依据的 revalidate 秒数（与页面配置保持一致，便于人读时对照）。 */
    readonly revalidateSec: number;
    /** 全部路由里最坏的那个结论：任何一个坏就要亮条，运维只看一眼结论。 */
    readonly verdict: IsrVerdict;
    /** 连续非 ok 的轮数：抖动一轮不报警，连续两轮才算异常（降低误报）。 */
    readonly badStreak: number;
    readonly findings: readonly IsrUrlFinding[];
}

/** 报告在 R2（ISR 缓存桶）里的固定键；_ops/ 前缀与缓存条目目录 incremental-cache/ 分开。 */
export const ISR_REPORT_KEY = "_ops/isr-health.json";

/** 非 ok 结论是否需要提醒（unknown 不提醒：样本不足不该打扰人）。 */
export function isrVerdictNeedsAction(verdict: IsrVerdict): boolean {
    return verdict !== "ok" && verdict !== "unknown";
}

/** 从 Cache-Control 值里取 s-maxage；没有或非法返回 null。 */
export function parseSMaxAge(cacheControl: string | null): number | null {
    if (!cacheControl) return null;
    const m = /(?:^|[,\s])s-maxage=(\d+)/.exec(cacheControl);
    return m?.[1] ? Number.parseInt(m[1], 10) : null;
}

/**
 * 判定一组样本。约定 samples[0] 是触发刷新的那次请求（不参与判定），其余都是复查。
 *
 * 时间口径（2026-10-22 校准，别再改回去）：**HIT 之前**出现 STALE/MISS 是正常的 —— 我们刚踢的
 * 后台刷新还没落地。实测单条暖路径 ~6 秒就写回；而探针一轮要并发暖 5 条（`/` + `/products` +
 * 3 个 slug），刷新排队 + 冷 Neon 首连，实测能到 26 秒以上。旧判据要求「复查全 HIT」，
 * 把这种慢当成坏死 → 连续 24 轮报 `never_hits`、`badStreak 24`，而链路其实好好的。
 *
 * 真正的坏形状只有两种：**到点还是从不 HIT**（写回断了），或者 **HIT 之后又退回非 HIT**
 * （条目保不住：双时钟互打、被清、写回被判即时过期 —— 就是本次事故最初的信号）。
 */
export function classifyIsrSamples(path: string, samples: readonly IsrSample[]): IsrUrlFinding {
    const failed = samples.some((s) => s.status === 0 || s.status >= 500);
    if (failed) return { path, samples, verdict: "error" };

    const followUps = samples.slice(1);
    if (followUps.length === 0) return { path, samples, verdict: "unknown" };

    const firstHit = followUps.findIndex((s) => s.cache === "HIT");
    if (firstHit < 0) {
        // 全都没有 ISR 头 = 这一跳根本没走增量缓存（页面被改成动态，或路由变了），和"写回断了"是两种故障。
        const noHeader = followUps.every((s) => s.cache === null);
        return { path, samples, verdict: noHeader ? "not_isr" : "never_hits" };
    }
    const fellBack = followUps.slice(firstHit + 1).some((s) => s.cache !== "HIT");
    return { path, samples, verdict: fellBack ? "oscillating" : "ok" };
}

/** 取最坏的结论（无路由时返回 unknown，宁可不报也不假报正常）。 */
export function worstIsrVerdict(findings: readonly IsrUrlFinding[]): IsrVerdict {
    if (findings.length === 0) return "unknown";
    return findings.reduce<IsrVerdict>(
        (worst, f) => (ISR_VERDICT_SEVERITY[f.verdict] > ISR_VERDICT_SEVERITY[worst] ? f.verdict : worst),
        "ok",
    );
}

/** 报告距今分钟数（渲染"多久没更新过了"用）；无报告时 null。 */
export function isrReportAgeMinutes(checkedAt: string | undefined, nowMs: number): number | null {
    if (!checkedAt) return null;
    const at = Date.parse(checkedAt);
    if (Number.isNaN(at)) return null;
    return Math.max(0, Math.round((nowMs - at) / 60_000));
}

/**
 * 读探针报告。只依赖一个注入的 get()（调用方把自己的 R2 绑定方法传进来），
 * 本函数不碰 env/全局类型，因此前台与后台可以共用同一份「键 + 形状」而不各写一遍。
 * 读不到就返回 null：运维面板要能退化成「未采集」，绝不能因为缓存报告读失败而让整页报错。
 */
export async function readIsrHealthReport(
    get: (key: string) => Promise<{ json<T = unknown>(): Promise<T> } | null>,
): Promise<IsrHealthReport | null> {
    try {
        const found = await get(ISR_REPORT_KEY);
        return found ? await found.json<IsrHealthReport>() : null;
    } catch {
        return null;
    }
}
