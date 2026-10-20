import { config } from "dotenv";
config({ path: "../../.env.local" });

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/client";

// 应用「专门迁移」：把 ledger_entries / stock_movements 重建为月分区，并核验。
// 运行：pnpm --filter @onestarry/db exec tsx scripts/apply-partition.ts
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("no DATABASE_URL_UNPOOLED");
    const db = createDb(url);

    const script = readFileSync("drizzle/manual/0014_partition_append_only.sql", "utf8");
    await db.execute(sql.raw(script));
    console.log("APPLIED");

    const chk = (await db.execute(
        sql.raw(`select c.relname, c.relkind,
                   (select count(*) from pg_inherits i where i.inhparent=c.oid) as partitions
                 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname in ('ledger_entries','stock_movements')
                 order by c.relname`),
    )) as unknown as { relname: string; relkind: string; partitions: number }[];
    for (const r of chk) console.log(`  ${r.relname}: relkind=${r.relkind} (p=分区) partitions=${r.partitions}`);

    for (const t of ["ledger_entries", "stock_movements"]) {
        const n = (await db.execute(sql.raw(`select count(*)::int as n from ${t}`))) as unknown as { n: number }[];
        console.log(`  ${t} 行数=${n[0]?.n}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
