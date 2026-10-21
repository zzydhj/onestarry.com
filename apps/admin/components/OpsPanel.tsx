import type { MaintenanceWindow } from "@onestarry/core";
import { WINDOW_STATUS_LABELS } from "@onestarry/core";
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
 * 运维面板（只读）：依赖支持窗口 + outbox 流水线健康。
 * 数据由页面取好传进来（本组件不碰 env/DB），便于单独审阅与复用。
 * 调用方负责权限判断 —— 这里只负责渲染。
 */
export function OpsPanel({ window: win, outbox }: { window: MaintenanceWindow; outbox: OutboxHealth }) {
    const now = new Date();
    const backlogBad = outbox.dead > 0 || outbox.failed > 0 || outbox.pending > 0;

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
        </section>
    );
}
