import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { healthPayload, readIsrHealthReport } from "@onestarry/core";

/** 不查库：依赖故障时也要能回答，同时充当 Worker 预热/放量判别靶子。 */
export const dynamic = "force-dynamic";

export async function GET() {
    // ISR 探针结论由 jobs 每 5 分钟写进 R2；读失败一律退化为 null，
    // 不能让本端点丢掉「必答」的性质（readIsrHealthReport 内部已吞异常，这里只兜无 Workers 上下文）。
    let isr: Awaited<ReturnType<typeof readIsrHealthReport>> = null;
    try {
        const { env } = getCloudflareContext();
        isr = await readIsrHealthReport((key) => env.NEXT_INC_CACHE_R2_BUCKET.get(key));
    } catch {
        isr = null;
    }

    return NextResponse.json({
        ...healthPayload("onestarry-web", { gitSha: process.env.APP_GIT_SHA, buildTime: process.env.APP_BUILD_TIME }),
        // null = 探针还没跑过（与 "ok" 必须区分，否则监控会把没数据当成健康）
        isr: isr ? { verdict: isr.verdict, badStreak: isr.badStreak, checkedAt: isr.checkedAt } : null,
    });
}
