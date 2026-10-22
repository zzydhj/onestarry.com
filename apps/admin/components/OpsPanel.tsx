import type { IsrHealthReport, IsrVerdict, MaintenanceWindow } from "@onestarry/core";
import { ISR_VERDICT_LABELS, WINDOW_STATUS_LABELS, isrReportAgeMinutes, isrVerdictNeedsAction } from "@onestarry/core";
import type { OutboxHealth } from "@onestarry/db";

/** 状态 → 颜色（复用 ui 包的语义色，不写死十六进制）。 */
const STATUS_STYLE: Record<MaintenanceWindow["status"], string> = {
    ok: "text-emerald-700 bg-emerald-50 border-emerald-200",
    warn: "text-amber-800 bg-amber-50 border-amber-200",
    expired: "text-red-800 bg-red-50 border-red-200",
    unknown: "text-red-800 bg-red-50 border-red-200",
};

function formatAge(from: Date | null, now: Date): string {
    if (!from) return "—";
    const mins = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
}

/**
 * ISR 结论 → 颜色。连续两轮非 ok 才升红：探针本身会被部署完成瞬间的旧条目干扰而抖一次，
 * 单次异常不值得打扰人（streak 已在 jobs 那边累加进报告）。
 */
function isrTone(verdict: IsrVerdict | "missing", badStreak: number): string {
    if (verdict === "ok") return STATUS_STYLE.ok;
    if (verdict === "missing" || verdict === "unknown") return STATUS_STYLE.unknown;
    if (verdict === "never_hits" || verdict === "not_isr" || verdict === "error") return STATUS_STYLE.expired;
    return badStreak >= 2 ? STATUS_STYLE.expired : STATUS_STYLE.warn;
}

/** 把一路的采样念成人能看的一串：STALE→HIT(47)→HIT(35)。 */
function isrTrail(caches: Array<string | null>, sMaxAges: Array<number | null>): string {
    return caches
        .map((c, i) => {
            if (!c) return "—";
            const ttl = sMaxAges[i];
            return ttl === null || ttl === undefined ? c : `${c}(${ttl})`;
        })
        .join("→");
}

/**
 * 运维面板（只读）：依赖支持窗口 + outbox 流水线健康 + ISR 缓存健康。
 * 数据由页面取好传进来（本组件不碰 env/DB/桶），便于单独审阅与复用。
 * 调用方负责权限判断 —— 这里只负责渲染。
 */
export function OpsPanel({ window: win, outbox, isr }: { window: MaintenanceWindow; outbox: OutboxHealth; isr: IsrHealthReport | null }) {
    const now = new Date();
    const backlogBad = outbox.dead > 0 || outbox.failed > 0 || outbox.pending > 0;
    const isrVerdict: IsrVerdict | "missing" = isr?.verdict ?? "missing";
    const isrLabel = isr ? ISR_VERDICT_LABELS[isr.verdict] : "未采集";
    const isrAge = isrReportAgeMinutes(isr?.checkedAt, now.getTime());

    // 进入排期区间但颜色仍绿（>60 天）时，提为黄色“该排期了”——因为维护者只看后台。
    const pill =
        win.needsAction && win.status === "ok"
            ? { cls: STATUS_STYLE.warn, text: `Next ${win.major} · 该排期升级了（建议 ${win.actionFrom} 前开工）` }
            : { cls: STATUS_STYLE[win.status], text: `Next ${win.major} · ${WINDOW_STATUS_LABELS[win.status]}` };

    return (
        <section className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-white p-4">
                <h2 className="text-sm font-semibold text-muted">依赖支持窗口</h2>
                <div className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium ${pill.cls}`}>
                    {pill.text}
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted">发布日</dt>
                        <dd className="tabular-nums">{win.releaseDate ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted">支持截止</dt>
                        <dd className="tabular-nums">{win.supportEndDate ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted">剩余天数</dt>
                        <dd className="font-semibold tabular-nums">{win.daysLeft === null ? "—" : `${win.daysLeft} 天`}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted">建议开工日</dt>
                        <dd className="font-semibold tabular-nums">{win.actionFrom ?? "—"}</dd>
                    </div>
                </dl>
                <p className="mt-3 text-xs text-muted">
                    超窗后 OpenNext 会在构建第一步直接拒部署（现网不会挂，但新代码上不去）。提醒提前 180 天开始亮 —— 看到黄条就可以安排一次升级，不必等到红。
                </p>
            </div>

            <div className="rounded-xl border border-line bg-white p-4">
                <h2 className="text-sm font-semibold text-muted">事件流水线（outbox）</h2>
                <div
                    className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium ${backlogBad ? STATUS_STYLE.warn : STATUS_STYLE.ok}`}
                >
                    {outbox.pending === 0 && outbox.failed === 0 && outbox.dead === 0 ? "无积压" : "有待处理事件"}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                        <dt className="text-muted text-xs">待办</dt>
                        <dd className="text-lg font-semibold tabular-nums">{outbox.pending}</dd>
                    </div>
                    <div>
                        <dt className="text-muted text-xs">失败</dt>
                        <dd className="text-lg font-semibold tabular-nums">{outbox.failed}</dd>
                    </div>
                    <div>
                        <dt className="text-muted text-xs">已放弃(dead)</dt>
                        <dd className="text-lg font-semibold tabular-nums">{outbox.dead}</dd>
                    </div>
                </dl>
                <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted">最老待办</dt>
                        <dd className="tabular-nums">{formatAge(outbox.oldestPendingAt, now)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                        <dt className="text-muted">最近成功派发</dt>
                        <dd className="tabular-nums">{formatAge(outbox.lastDispatchedAt, now)}</dd>
                    </div>
                </dl>
                <p className="mt-3 text-xs text-muted">
                    relay 由 <code>onestarry-jobs</code> 每分钟消费；「最老待办」持续增长即说明流水线卡住（改价不会生效到前台）。
                </p>
            </div>

            <div className="rounded-xl border border-line bg-white p-4 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-muted">边缘缓存（ISR）</h2>
                    <div className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium ${isrTone(isrVerdict, isr?.badStreak ?? 0)}`}>
                        {isrLabel}
                        {isr && isr.badStreak > 0 && isrVerdictNeedsAction(isr.verdict) ? ` · 连续 ${isr.badStreak} 轮` : ""}
                    </div>
                </div>
                {isr ? (
                    <ul className="mt-3 space-y-1 text-sm">
                        {isr.findings.map((f) => (
                            <li key={f.path} className="flex flex-wrap items-baseline justify-between gap-3">
                                <code className="font-mono text-xs">{f.path}</code>
                                <span className="tabular-nums text-xs text-muted">
                                    {isrTrail(f.samples.map((s) => s.cache), f.samples.map((s) => s.sMaxAge))}
                                </span>
                                <span className={`text-xs font-medium ${isrTone(f.verdict, isr.badStreak)}`}>
                                    {ISR_VERDICT_LABELS[f.verdict]}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="mt-3 text-sm text-muted">
                        还没有报告：<code>onestarry-jobs</code> 的 <code>*/5 * * * *</code> 探针每 5 分钟写一次，刚部署完等一轮。
                    </p>
                )}
                <p className="mt-3 text-xs text-muted">
                    探针打法：先打一发作「触发刷新」（那一发不参与判定），等 12s 再复查两发。健康时复查应全为 HIT；
                    <strong>oscillating</strong>（HIT/STALE 交替）= 条目年龄有两套真值在互相打脸；
                    <strong>never_hits</strong> = 写回断了。两者都意味着读页每个访客全部回源全额渲染（要付数据库税）。
                    {isr
                        ? ` · 最近采样 ${isrAge === null ? "—" : isrAge < 120 ? `${isrAge} 分钟前` : `${Math.round(isrAge / 60)} 小时前`} · revalidate ${isr.revalidateSec}s`
                        : ""}
                </p>
            </div>
        </section>
    );
}
