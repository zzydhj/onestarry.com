/**
 * 健康端点载荷（web / admin 共用，保证两边字段一致，便于统一监控与放量判别）。
 *
 * gitSha / buildTime 由构建期注入（见 scripts/build-stamp.mjs + 两个 next.config 的 `env`），
 * 用途：Cloudflare Workers 同时保留多个历史版本，放量时要能一眼确认“现在承接流量的是哪个提交”。
 *
 * 本函数保持**纯函数**（不收 process）：core 被各包以源码形式参与编译，那里不保证有 node 类型；
 * 环境变量由调用方（路由自己已有 node/Next 类型）读好后传进来。
 * 健康端点刻意**不查数据库**：依赖故障时也要能回答，也可当预热靶子。
 */
export interface HealthPayload {
    ok: true;
    service: string;
    gitSha: string;
    buildTime: string;
    ts: number;
}

export function healthPayload(
    service: string,
    stamp: { gitSha?: string | undefined; buildTime?: string | undefined },
    now: number = Date.now(),
): HealthPayload {
    return {
        ok: true,
        service,
        gitSha: stamp.gitSha ?? "unknown",
        buildTime: stamp.buildTime ?? "unknown",
        ts: now,
    };
}
