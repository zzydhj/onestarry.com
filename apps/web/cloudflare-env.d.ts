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
    // MEDIA: R2Bucket; // 需要 @cloudflare/workers-types，接图片上传时再补
}
