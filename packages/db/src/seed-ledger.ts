import { config } from "dotenv";
config({ path: "../../.env.local" });

import { createDb } from "./client";
import { legalEntities } from "./schema";
import { seedLedgerAccounts } from "./queries";

/** 为所有现有法人补齐标准账本科目（幂等）。运行：pnpm --filter @onestarry/db seed:ledger */
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const les = await db.select({ id: legalEntities.id, name: legalEntities.displayName }).from(legalEntities);
    for (const le of les) {
        await seedLedgerAccounts(db, le.id);
        console.log(`✅ 已补齐账本科目：${le.name}`);
    }
    console.log(`共处理 ${les.length} 个法人`);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
