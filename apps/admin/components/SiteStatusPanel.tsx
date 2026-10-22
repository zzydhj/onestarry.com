import type { IsrHealthReport, MaintenanceWindow } from "@onestarry/core";
import {
    CACHE_LAYERS,
    INVALIDATION_LABELS,
    RENDER_KIND_LABELS,
    SITE_BINDINGS,
    SITE_CRONS,
    SITE_ROUTES,
    formatRevalidate,
    worstPropagationSeconds,
    type SiteRoute,
} from "@onestarry/core";

/** 一个 Worker 的版本快照（可达性与版本号分开：不可达本身就是要看见的事实）。 */
export interface WorkerVersion {
    name: string;
    role: string;
    reachable: boolean;
    gitSha: string | null;
    buildTime: string | null;
    /** 没有对外健康端点的（jobs）说明去哪儿看。 */
    note?: string;
}

export interface SiteStatusData {
    workers: WorkerVersion[];
    /** null = 前台不可达，读不到，而不是"没配"。 */
    invalidateConfigured: boolean | null;
    isr: IsrHealthReport | null;
    window: MaintenanceWindow;
}

const TONE = {
    ok: "text-emerald-700 bg-emerald-50 border-emerald-200",
    warn: "text-amber-800 bg-amber-50 border-amber-200",
    bad: "text-red-800 bg-red-50 border-red-200",
    mute: "text-muted bg-slate-50 border-line",
} as const;

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-muted">{title}</h2>
                {hint ? <span className="text-xs text-muted">{hint}</span> : null}
            </div>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function Pill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
    return <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

/** 渲染策略 → 颜色：私有/动态不该被误当成"坏了"。 */
function kindTone(kind: SiteRoute["kind"]): keyof typeof TONE {
    return kind === "prerender-isr" || kind === "static" ? "ok" : kind === "private" ? "mute" : "warn";
}

function RouteTable({ routes }: { routes: SiteRoute[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="py-1.5 pr-3 font-medium">路径</th>
                        <th className="py-1.5 pr-3 font-medium">说明</th>
                        <th className="py-1.5 pr-3 font-medium">渲染</th>
                        <th className="py-1.5 pr-3 font-medium">缓存窗口</th>
                        <th className="py-1.5 pr-3 font-medium">边缘</th>
                        <th className="py-1.5 font-medium">失效方式</th>
                    </tr>
                </thead>
                <tbody>
                    {routes.map((r) => (
                        <tr key={r.path} className="border-b border-line/60 align-top last:border-0">
                            <td className="py-1.5 pr-3">
                                <code className="font-mono text-xs">{r.path}</code>
                            </td>
                            <td className="py-1.5 pr-3">
                                {r.label}
                                {r.note ? <div className="mt-0.5 text-xs text-muted">{r.note}</div> : null}
                            </td>
                            <td className="py-1.5 pr-3">
                                <Pill tone={kindTone(r.kind)}>{RENDER_KIND_LABELS[r.kind].split("（")[0]}</Pill>
                            </td>
                            <td className="py-1.5 pr-3 tabular-nums">{r.revalidateSec === null ? "—" : formatRevalidate(r.revalidateSec)}</td>
                            <td className="py-1.5 pr-3">{r.edgeCacheable ? "存" : "跳过"}</td>
                            <td className="py-1.5 text-xs">{INVALIDATION_LABELS[r.invalidation]}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function formatTime(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) + "（北京）";
}

/**
 * 站点状态面板（只读）：把"整站在怎么跑"一次列全 —— 缓存分层、逐路由的窗口与失效方式、
 * 三个 Worker 的版本、cron 清单、绑定与密钥配置。
 *
 * 数据分两类，界面上必须分开标注，否则会让人误以为登记表也是探测结果：
 *   · **声明**（来自 @onestarry/core 的登记表）= 代码里写的是什么；
 *   · **实测**（/api/health 与 R2 探针报告）= 线上现在是什么。
 * 两者不一致就是 bug —— 而且正是 2026-10-22 那轮事故里"没人知道缓存坏了"的成因（架构方案 §22）。
 */
export function SiteStatusPanel({ workers, invalidateConfigured, isr, window: win }: SiteStatusData) {
    const publicRoutes = SITE_ROUTES.filter((r) => r.kind === "prerender-isr" || r.kind === "static");
    const privateRoutes = SITE_ROUTES.filter((r) => r.kind === "private" || r.kind === "dynamic");
    const shas = new Set(workers.filter((w) => w.reachable && w.gitSha).map((w) => w.gitSha));
    const versionAligned = shas.size <= 1;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Pill tone="ok">改完可见上界 {formatRevalidate(worstPropagationSeconds())}</Pill>
                <Pill tone={isr?.verdict === "ok" ? "ok" : isr ? "bad" : "warn"}>
                    ISR 探针：{isr ? isr.verdict : "未采集"}{isr && isr.badStreak > 0 ? ` · 连续 ${isr.badStreak} 轮` : ""}
                </Pill>
                <Pill tone={versionAligned ? "ok" : "warn"}>版本 {versionAligned ? "一致" : "不一致（放量中或某站没部署）"}</Pill>
                <Pill tone={invalidateConfigured === true ? "ok" : invalidateConfigured === false ? "warn" : "mute"}>
                    失效通道密钥 {invalidateConfigured === true ? "已配" : invalidateConfigured === false ? "未配（退化为只靠窗口）" : "读不到"}
                </Pill>
                <Pill tone={win.status === "ok" ? "ok" : win.status === "warn" ? "warn" : "bad"}>
                    Next {win.major} 支持窗剩 {win.daysLeft ?? "—"} 天
                </Pill>
            </div>

            <Card title="缓存分了几层" hint="判读线上响应时必须按层看，混在一体会得出错误结论">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-xs text-muted">
                                <th className="py-1.5 pr-3 font-medium">层</th>
                                <th className="py-1.5 pr-3 font-medium">在哪</th>
                                <th className="py-1.5 pr-3 font-medium">TTL 由什么决定</th>
                                <th className="py-1.5 font-medium">谁能提前打破</th>
                            </tr>
                        </thead>
                        <tbody>
                            {CACHE_LAYERS.map((l) => (
                                <tr key={l.name} className="border-b border-line/60 align-top last:border-0">
                                    <td className="py-1.5 pr-3 font-medium">{l.name}</td>
                                    <td className="py-1.5 pr-3 text-xs">{l.where}</td>
                                    <td className="py-1.5 pr-3 text-xs">{l.ttlSource}</td>
                                    <td className="py-1.5 text-xs">
                                        {l.brokenBy}
                                        <div className="mt-0.5 text-muted">{l.note}</div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card title={`公开读页（${publicRoutes.length} 条）`} hint="这一组才吃 ISR；窗口就是「改完多久可见」的上界">
                <RouteTable routes={publicRoutes} />
            </Card>

            <Card title={`交易 / 私有 / 接口（${privateRoutes.length} 条）`} hint="全部 no-store：边缘自动 BYPASS，被缓存住哪怕几秒都是事故">
                <RouteTable routes={privateRoutes} />
            </Card>

            <Card title="定时任务" hint="表达式与 apps/jobs/wrangler.jsonc 由单测强制一致">
                <ul className="space-y-2 text-sm">
                    {SITE_CRONS.map((c) => (
                        <li key={c.cron} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <code className="font-mono text-xs">{c.cron}</code>
                            <span className="font-medium">{c.does}</span>
                            <span className="w-full text-xs text-muted">挂了会怎样：{c.impact}</span>
                        </li>
                    ))}
                </ul>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card title="部署单元" hint="版本取自各站 /api/health">
                    <ul className="space-y-2 text-sm">
                        {workers.map((w) => (
                            <li key={w.name} className="flex flex-wrap items-baseline justify-between gap-2">
                                <div>
                                    <code className="font-mono text-xs">{w.name}</code>
                                    <span className="ml-2 text-xs text-muted">{w.role}</span>
                                </div>
                                <div className="text-xs tabular-nums">
                                    {w.reachable ? (
                                        <>
                                            <span className="font-mono">{w.gitSha ?? "?"}</span>
                                            <span className="ml-2 text-muted">{formatTime(w.buildTime)}</span>
                                        </>
                                    ) : (
                                        <span className="text-muted">{w.note ?? "不可达"}</span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>

                <Card title="绑定与密钥" hint="缺了会怎样的那一列写在右边">
                    <ul className="space-y-2 text-sm">
                        {SITE_BINDINGS.map((b) => (
                            <li key={b.binding} className="flex flex-wrap items-baseline gap-x-2">
                                <code className="font-mono text-xs">{b.binding}</code>
                                <span className="text-xs text-muted">{b.worker}</span>
                                <span className="text-xs">{b.what}</span>
                                <span className="w-full text-xs text-muted">缺：{b.missing}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            </div>

            <p className="text-xs text-muted">
                本页左列是<b>声明</b>（代码里写的是什么，来自 <code className="font-mono">@onestarry/core/site-status</code>），
                顶部徽标与部署单元是<b>实测</b>（线上现在是什么）。两者不一致 = 有东西在说谎，
                漂移守卫单测会红：<code className="font-mono">packages/core/src/site-status.test.ts</code>。
                判读法与事故全案见 <code className="font-mono">docs/PERF.md</code> §6/§7 与架构方案 §22。
            </p>
        </div>
    );
}
