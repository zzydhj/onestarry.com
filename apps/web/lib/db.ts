import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "@onestarry/db";

/** 连接串：运行期用 Hyperdrive 绑定；构建期（SSG 预渲染）无 Workers 上下文 → 回退 CI 注入的 DATABASE_URL（Neon 池化）。 */
function dbUrl(): string {
    try {
        return getCloudflareContext().env.HYPERDRIVE.connectionString;
    } catch {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("构建期缺少 DATABASE_URL：请在 Workers Builds 环境变量配置 Neon 池化连接串");
        return url;
    }
}

/** 前台各页统一取 DB 实例（连接策略单一真源）。 */
export function getDb() {
    return createDb(dbUrl());
}
