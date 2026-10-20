import { config } from "dotenv";
config({ path: "../../.env.local" });

import { sql } from "drizzle-orm";
import { createDb } from "./client";

// 临时验证 0015 授权模型：用一次性测试角色跑 grant/revoke，查权限是否符合预期，再删。用完即删。
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("no DATABASE_URL_UNPOOLED");
    const db = createDb(url);
    const R = "app_rw_probe";

    await db.execute(sql.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${R}') THEN CREATE ROLE ${R} LOGIN PASSWORD 'probe_only_local'; END IF; END $$;`));
    await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${R};`));
    await db.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${R};`));
    await db.execute(sql.raw(`REVOKE UPDATE, DELETE ON ledger_entries, stock_movements FROM ${R};`));

    const g = (await db.execute(sql.raw(`
        select table_name, privilege_type
        from information_schema.role_table_grants
        where grantee='${R}' and table_name in ('ledger_entries','stock_movements','transactional_outbox','orders')
        order by table_name, privilege_type`))) as unknown as { table_name: string; privilege_type: string }[];
    const has = (t: string, p: string) => g.some((x) => x.table_name === t && x.privilege_type === p);
    console.log(`ledger_entries     : SELECT=${has("ledger_entries", "SELECT")} UPDATE=${has("ledger_entries", "UPDATE")} DELETE=${has("ledger_entries", "DELETE")}  (期望 SELECT=true, UPDATE/DELETE=false)`);
    console.log(`stock_movements    : SELECT=${has("stock_movements", "SELECT")} UPDATE=${has("stock_movements", "UPDATE")} DELETE=${has("stock_movements", "DELETE")}  (期望 SELECT=true, UPDATE/DELETE=false)`);
    console.log(`transactional_outbox: SELECT=${has("transactional_outbox", "SELECT")} UPDATE=${has("transactional_outbox", "UPDATE")}  (期望 true——relay 要 UPDATE)`);
    console.log(`orders             : INSERT=${has("orders", "INSERT")} UPDATE=${has("orders", "UPDATE")} DELETE=${has("orders", "DELETE")}  (期望 true)`);

    await db.execute(sql.raw(`DROP ROLE ${R};`));
    console.log("PROBE_DROPPED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
