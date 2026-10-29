import { PERMISSIONS, SITE_WORKERS, computeMaintenanceWindow, readIsrHealthReport } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { SiteStatusPanel, type WorkerVersion } from "@/components/SiteStatusPanel";
import { PrefetchLink } from "@/components/PrefetchLink";

export const dynamic = "force-dynamic";

/** 探别的 Worker 要设超时：跨 Worker 调用没有"本地失败"这种温柔结局，不设上限就是拿后台页的 TTFB 赌对方活着。 */
const PROBE_TIMEOUT_MS = 8000;

interface HealthProbe {
    reachable: boolean;
    gitSha: string | null;
    buildTime: string | null;
    invalidateConfigured: boolean | null;
}

async function probeHealth(url: string | null): Promise<HealthProbe> {
    const dead: HealthProbe = { reachable: false, gitSha: null, buildTime: null, invalidateConfigured: null };
    if (!url) return dead;
    try {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (!res.ok) return dead;
        const j = (await res.json()) as Partial<{ gitSha: string; buildTime: string; invalidateConfigured: boolean }>;
        return {
            reachable: true,
            gitSha: typeof j.gitSha === "string" ? j.gitSha : null,
            buildTime: typeof j.buildTime === "string" ? j.buildTime : null,
            invalidateConfigured: typeof j.invalidateConfigured === "boolean" ? j.invalidateConfigured : null,
        };
    } catch {
        return dead;
    }
}

/**
 * 站点状态（只读，`config:write` 可见）：整站的缓存分层、逐路由窗口与失效方式、
 * 三个 Worker 的版本、cron 清单、绑定与密钥配置，一屏列全。
 *
 * 为什么值得单独一页：2026-10-22 那轮缓存事故的制度结论是"坏法无声 —— 不报错、内容照对，
 * 只是每个访客多付一次跨洋渲染"（架构方案 §22）。这类事要么有面板可看，要么靠人撞见。
 */
export default async function SiteStatusPage() {
    const { env } = await requirePermission(PERMISSIONS.configWrite);

    const [web, isr] = await Promise.all([
        probeHealth(SITE_WORKERS.find((w) => w.name === "onestarry-com")?.healthUrl ?? null),
        readIsrHealthReport((key) => env.ISR_CACHE.get(key)),
    ]);

    const workers: WorkerVersion[] = SITE_WORKERS.map((w) => {
        if (w.name === "onestarry-com") {
            return { name: w.name, role: w.role, reachable: web.reachable, gitSha: web.gitSha, buildTime: web.buildTime };
        }
        // 自己这一份不需要网络：构建期注入的 stamp 就是真值（scripts/build-stamp.mjs）。
        if (w.name === "onestarry-admin") {
            return {
                name: w.name,
                role: w.role,
                reachable: true,
                gitSha: process.env.APP_GIT_SHA ?? null,
                buildTime: process.env.APP_BUILD_TIME ?? null,
            };
        }
        return { name: w.name, role: w.role, reachable: false, gitSha: null, buildTime: null, note: "无对外健康端点：看 Cloudflare → 该 Worker → 日志" };
    });

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">站点状态</h1>
                <PrefetchLink href="/" className="text-sm text-muted transition hover:text-accent">
                    ← 返回概览
                </PrefetchLink>
            </div>
            <p className="mt-1 text-sm text-muted">
                缓存时间、渲染策略、定时任务、部署版本与运行时依赖。数据分「声明」与「实测」两类，页面底部写明哪列是哪类。
            </p>
            <div className="mt-6">
                <SiteStatusPanel
                    workers={workers}
                    invalidateConfigured={web.invalidateConfigured}
                    isr={isr}
                    window={computeMaintenanceWindow()}
                />
            </div>
        </div>
    );
}
