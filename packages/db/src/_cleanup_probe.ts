import { config } from "dotenv";
config({ path: "../../.env.local" });

import { sql } from "drizzle-orm";
import { createDb } from "./client";

// 清理 app_rw_probe：先撤销一切成员/授权，再 DROP ROLE；若仍失败则打印 pg_shdepend 依赖。
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("no DATABASE_URL_UNPOOLED");
    const db = createDb(url);

    // 撤销可能残留的默认权限/成员关系
    await db.execute(sql.raw(`REVOKE ALL ON SCHEMA public FROM app_rw_probe;`));
    await db.execute(sql.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_rw_probe;`));
    await db.execute(sql.raw(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_rw_probe;`));

    try {
        await db.execute(sql.raw(`DROP ROLE app_rw_probe;`));
        console.log("DROPPED_OK");
    } catch (e) {
        console.log("DROP_FAILED: " + (e instanceof Error ? e.message.slice(0, 120) : String(e)));
        const dep = (await db.execute(sql.raw(`
            select classid::regclass::text as kind, objid,
                   (select rolname from pg_roles where oid = pg_shdepend.roleid) as for_role
            from pg_shdepend
            where deptype='o' and refobjid = (select oid from pg_authid where rolname='app_rw_probe')`))) as unknown as object[];
        console.table(dep);
        const owned = (await db.execute(sql.raw(`
            select c.relname from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname='app_rw_probe'`))) as unknown as object[];
        console.log("owned objects:");
        console.table(owned);
    }
    const left = (await db.execute(sql.raw(`select count(*)::int n from pg_roles where rolname='app_rw_probe'`))) as unknown as { n: number }[];
    console.log(`probe role remaining=${left[0]?.n}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
