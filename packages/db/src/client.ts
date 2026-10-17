import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/**
 * 运行时 DB 工厂。
 * - Cloudflare Workers：经 Hyperdrive 暴露为 WebSocket/TCP，用 postgres-js 驱动（支持交互式事务）。
 * - 迁移/脚本：直连 Neon 非池化 URL。
 * 注意：写路径禁用 drizzle neon-http（不支持 BEGIN…COMMIT 多语句事务）。
 *
 * 按 url 缓存实例：同一 isolate 内复用连接（避免每请求重新握手）；Hyperdrive 在服务端再做池化。
 */
const dbCache = new Map<string, Db>();

export function createDb(url: string): Db {
    let db = dbCache.get(url);
    if (!db) {
        db = buildDb(url);
        dbCache.set(url, db);
    }
    return db;
}

export type Db = ReturnType<typeof buildDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function buildDb(url: string) {
    const client = postgres(url, {
        prepare: false, // Hyperdrive / 池化代理需关闭语句缓存
        max: 1, // Workers 每 isolate 单连接，交由 Hyperdrive 做池
    });
    return drizzle(client, { schema, casing: "snake_case" });
}

export { schema };
