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
    MEDIA: R2Bucket;
}

// 最小 R2 接口（仅用到 put），免引入 @cloudflare/workers-types。
interface R2Bucket {
    put(
        key: string,
        value: ArrayBuffer | Uint8Array | string,
        options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
    ): Promise<unknown>;
    delete(key: string): Promise<unknown>;
}
