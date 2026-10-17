import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/**
 * 运行时 DB 工厂。
 * - Cloudflare Workers：经 Hyperdrive 暴露为 WebSocket/TCP，用 postgres-js 驱动（支持交互式事务）。
 * - 迁移/脚本：直连 Neon 非池化 URL。
 * 注意：写路径禁用 drizzle neon-http（不支持 BEGIN…COMMIT 多语句事务）。
 *
 * 每请求新建 client（max:1）：Workers isolate 冻结/解冻会重置 socket，跨请求复用单连接易踩死连接导致间歇 500；
 * 交给 Hyperdrive 在服务端做连接池/复用，应用层不缓存 client。
 */
export function createDb(url: string) {
    const client = postgres(url, {
        prepare: false, // Hyperdrive / 池化代理需关闭语句缓存
        max: 1, // Workers 每 isolate 单连接，交由 Hyperdrive 做池
    });
    return drizzle(client, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export { schema };
