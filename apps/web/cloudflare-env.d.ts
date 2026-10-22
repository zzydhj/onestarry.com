// Cloudflare 运行时绑定类型（占位，可被 `pnpm --filter @onestarry/web cf-typegen` 覆盖为 wrangler 生成版）。
interface Hyperdrive {
    readonly name: string;
    readonly id: string;
    readonly connectionString: string;
    readonly database: string;
    readonly host: string;
    readonly port: string;
    readonly user: string;
    readonly password: string;
}

interface CloudflareEnv {
    HYPERDRIVE: Hyperdrive;
    BETTER_AUTH_SECRET: string;
    /** 与 admin 共享的失效密钥（Workers secret）。可缺：缺了 /api/internal/invalidate 一律 401，前台退回 60s 定时器兜底。 */
    INVALIDATE_SECRET?: string;
    /** ISR 成品页桶（wrangler.jsonc 已绑）：/api/health 只读里面的 _ops/ 健康报告。 */
    NEXT_INC_CACHE_R2_BUCKET: R2Bucket;
    // MEDIA: R2Bucket; // 需要 @cloudflare/workers-types，接图片上传时再补
}

// 最小 R2 接口（前台只读，仅用到 get），免引入 @cloudflare/workers-types。
interface R2Bucket {
    get(key: string): Promise<{ json<T = unknown>(): Promise<T> } | null>;
}
