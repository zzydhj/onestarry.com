// Cloudflare 运行时绑定类型（占位，可被 cf-typegen 覆盖）。
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
    /** 与前台 web Worker 共享的失效密钥（Workers secret，两边同值）。可缺：缺了后台保存照旧成功，前台退回 60s 定时器追平。 */
    INVALIDATE_SECRET?: string;
    MEDIA: R2Bucket;
    /** 前台 ISR 缓存桶（只读）：取 jobs 写在 _ops/ 的 ISR 健康报告。 */
    ISR_CACHE: R2Bucket;
}

// 最小 R2 接口（仅用到 put/delete/get），免引入 @cloudflare/workers-types。
interface R2Bucket {
    put(
        key: string,
        value: ArrayBuffer | Uint8Array | string,
        options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
    ): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    get(key: string): Promise<{ json<T = unknown>(): Promise<T> } | null>;
}
