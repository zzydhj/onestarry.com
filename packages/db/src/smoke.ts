import { config } from "dotenv";
config({ path: "../../.env.local" });

import { sql } from "drizzle-orm";
import { createDb } from "./client";
import { legalEntities } from "./schema";

/**
 * 端到端冒烟：连真实 Neon → 数表 → 插入 legal_entities（验证 UUIDv7 默认值）→ 读回 → 清理。
 * 运行：pnpm --filter @onestarry/db smoke
 */
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置（先跑 neon env pull）");
    const db = createDb(url);

    const [{ c: tableCount }] = await db.execute<{ c: number }>(
        sql`select count(*)::int as c from information_schema.tables where table_schema = 'public'`,
    );
    console.log(`public schema 表数量: ${tableCount}`);

    const [inserted] = await db
        .insert(legalEntities)
        .values({ jurisdiction: "US", displayName: "Smoke Test LLC" })
        .returning();
    console.log(`插入 legal_entity: id=${inserted.id} functionalCurrency=${inserted.functionalCurrency} status=${inserted.status}`);

    const rows = await db.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities).where(sql`${legalEntities.id} = ${inserted.id}`);
    console.log(`读回: ${JSON.stringify(rows)}`);

    const isUuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/.test(inserted.id);
    console.log(`id 是 UUIDv7: ${isUuidV7}`);

    await db.delete(legalEntities).where(sql`${legalEntities.id} = ${inserted.id}`);
    console.log("已清理测试行。");
    console.log(isUuidV7 && tableCount >= 22 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
