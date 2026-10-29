import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "../src/client";
import { uuidv7 } from "../src/uuid7";

/**
 * 应用「专门迁移」manual/0017（凭证与流水的改写权收紧 + stock_movements 外键 CASCADE→RESTRICT），
 * 并在**同一次运行**里跑出改前/改后的对照，让"这条不变量真的堵上了"成为可复核的实测而不是声明。
 *
 * 运行（维护窗口内，先补 M-9 的叶级撤销再收紧父表）：
 *   pnpm --filter @onestarry/db db:partition
 *   pnpm --filter @onestarry/db db:hardening
 *
 * ⚠ 全部 DDL 取 ACCESS EXCLUSIVE；0017 自带 `SET LOCAL lock_timeout='3s'`，抢不到锁会快速失败，
 *   不会把该表的读写拖成排队雪崩（2026-10-29 踩过一次）。失败就换时段重跑，脚本幂等。
 */

/** drizzle 把 PG 错误包成 "Failed query: …"，原始 message/code 在 cause 上 ⇒ 四层都要拼进来才能断言。 */
function errText(e: unknown): string {
    const x = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return [x.message, x.code, x.cause?.message, x.cause?.code].filter(Boolean).join(" | ");
}

/** 需要复核权限关系的表（含 M-9 的两张父表作对照基线）。 */
const TABLES = ["ledger_transactions", "invoices", "credit_notes", "product_variants", "ledger_entries", "stock_movements"];

type PrivRow = { relname: string; upd: boolean; del: boolean };
type FkRow = { conname: string; confdeltype: string };

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("no DATABASE_URL_UNPOOLED（DDL 必须走表主，不能走 app_rw）");
    const db = createDb(url);

    const privList = TABLES.map((t) => `'${t}'::regclass`).join(", ");
    const readPrivs = () =>
        db.execute(sql.raw(`
            select c.relname::text as relname,
                   has_table_privilege('app_rw', c.oid, 'UPDATE') as upd,
                   has_table_privilege('app_rw', c.oid, 'DELETE') as del
            from pg_class c where c.oid in (${privList}) order by c.relname`)) as unknown as Promise<PrivRow[]>;
    const readFk = () =>
        db.execute(sql.raw(`
            select con.conname::text as conname, con.confdeltype::text as confdeltype
            from pg_constraint con
            where con.contype='f' and con.conrelid='stock_movements'::regclass
              and con.confrelid='product_variants'::regclass`)) as unknown as Promise<FkRow[]>;

    /**
     * 级联实证：事务内建「商品→变体→一条库存流水」，然后删那个变体。
     * 外键是 CASCADE 时删除成功、流水跟着消失；改成 RESTRICT 后必须撞 23503。
     * 全程回滚，不留数据（这也是为什么能直接在生产库上做）。
     */
    async function cascadeProbe(): Promise<{ deleted: boolean; movementsLeft: number; err: string }> {
        const ROLLBACK = Symbol("rollback");
        let deleted = false;
        let movementsLeft = -1;
        let err = "";
        try {
            await db.transaction(async (tx) => {
                const suffix = Date.now();
                // 主键由 app 层 UUIDv7 `$defaultFn` 生成，库里**没有** DB 默认 ⇒ raw SQL 必须显式给 id（写 default 会撞非空）
                const pid = uuidv7();
                const vid = uuidv7();
                await tx.execute(sql.raw(`insert into products (id, status) values ('${pid}', 'active')`));
                await tx.execute(sql.raw(`insert into product_variants (id, product_id, sku) values ('${vid}', '${pid}', 'HARDPROBE-${suffix}')`));
                await tx.execute(sql.raw(`insert into stock_movements (id, variant_id, type, quantity) values ('${uuidv7()}', '${vid}', 'receive', 5)`));
                try {
                    // 失败的 DML 会把整个事务置为 aborted（25P02），之后的 SELECT 会被拒 ⇒ 用 savepoint 圈住这次尝试
                    await tx.execute(sql.raw(`savepoint probe`));
                    try {
                        await tx.execute(sql.raw(`delete from product_variants where id = '${vid}'`));
                        deleted = true;
                    } catch (e) {
                        err = errText(e);
                        await tx.execute(sql.raw(`rollback to savepoint probe`));
                    }
                } catch (e) {
                    err = err || errText(e);
                }
                const n = (await tx.execute(
                    sql.raw(`select count(*)::int as n from stock_movements where variant_id = '${vid}'`),
                )) as unknown as { n: number }[];
                movementsLeft = n[0]!.n;
                throw ROLLBACK;
            });
        } catch (e) {
            if (e !== ROLLBACK) throw e;
        }
        return { deleted, movementsLeft, err };
    }

    /** app_rw 视角的行为实证：SET LOCAL ROLE 后真去改写凭证头，应被 42501 拒。 */
    async function appRwProbe(): Promise<string> {
        const ROLLBACK = Symbol("rollback");
        try {
            await db.transaction(async (tx) => {
                await tx.execute(sql.raw(`set local role app_rw`));
                await tx.execute(sql.raw(`update ledger_transactions set memo = coalesce(memo,'') || '#hardening-probe'`));
                throw ROLLBACK; // 到不了这里
            });
        } catch (e) {
            if (e === ROLLBACK) return "ALLOWED（未被拒绝！）";
            return errText(e);
        }
        return "ALLOWED（未被拒绝！）";
    }

    /**
     * 分区**叶**的权限（审查 M-9）：0015 的 `GRANT ... ON ALL TABLES` 把 UPDATE/DELETE 授到了每张叶，
     * 而 REVOKE 父表**不传导**；直接点名叶做 DML 时按叶权限判定 ⇒ 只追加必须在叶上成文。
     * 回填由 manual/0014 末尾那段完成，这里当场遍历当前所有子分区核实。
     */
    const readLeaves = () =>
        db.execute(sql.raw(`
            select c.oid::regclass::text as child,
                   has_table_privilege('app_rw', c.oid, 'UPDATE') as upd,
                   has_table_privilege('app_rw', c.oid, 'DELETE') as del
            from pg_inherits i join pg_class c on c.oid = i.inhrelid
            where i.inhparent in ('ledger_entries'::regclass, 'stock_movements'::regclass)
            order by c.relname`)) as unknown as Promise<{ child: string; upd: boolean; del: boolean }[]>;

    const before = await readPrivs();
    const leavesBefore = await readLeaves();
    const fkBefore = await readFk();
    console.log("== BEFORE 权限 ==");
    for (const r of before) console.log(`  ${r.relname}: UPDATE=${r.upd} DELETE=${r.del}`);
    console.log(`== BEFORE 外键 == ${fkBefore.map((f) => `${f.conname}(${f.confdeltype})`).join(", ") || "(无)"}`);
    console.log(`== BEFORE 分区叶 == ${leavesBefore.length} 张，仍可改写 ${leavesBefore.filter((l) => l.upd || l.del).length} 张`);
    const probeBefore = await cascadeProbe();
    console.log(`== BEFORE 级联实证 == 删变体 deleted=${probeBefore.deleted} 流水剩余=${probeBefore.movementsLeft} err=${probeBefore.err || "-"}`);

    await db.execute(sql.raw(readFileSync("drizzle/manual/0017_append_only_hardening.sql", "utf8").replace(/^--.*$/gm, "")));
    console.log("APPLIED 0017");

    const after = await readPrivs();
    const leavesAfter = await readLeaves();
    const fkAfter = await readFk();
    console.log("== AFTER 权限 ==");
    for (const r of after) console.log(`  ${r.relname}: UPDATE=${r.upd} DELETE=${r.del}`);
    console.log(`== AFTER 外键 == ${fkAfter.map((f) => `${f.conname}(${f.confdeltype})`).join(", ")}`);

    const expect = (name: string, key: "upd" | "del") => {
        const row = after.find((r) => r.relname === name)!;
        assert.ok(row, `${name} 没查到`);
        assert.equal(row[key], false, `app_rw 对 ${name} 仍有 ${key === "upd" ? "UPDATE" : "DELETE"}（REVOKE 没生效？）`);
    };
    for (const t of ["ledger_transactions", "invoices", "credit_notes"]) {
        expect(t, "upd");
        expect(t, "del");
    }
    expect("product_variants", "del");
    // 基线不能动：两张只追加父表本来就是 false
    expect("ledger_entries", "upd");
    expect("stock_movements", "upd");

    assert.deepEqual(
        fkAfter.map((f) => f.confdeltype),
        ["r"],
        `stock_movements→product_variants 的外键必须只剩一条且是 RESTRICT(r)，实际 ${JSON.stringify(fkAfter)}`,
    );

    // M-9：每张叶分区都必须已被重申撤销（先跑 db:partition 的那段循环）
    assert.ok(leavesAfter.length > 0, "一张子分区都没查到 ⇒ 分区结构异常，先跑 db:partition 再看");
    const leaky = leavesAfter.filter((l) => l.upd || l.del);
    console.log(`== AFTER 分区叶 == ${leavesAfter.length} 张，仍可改写 ${leaky.length} 张`);
    assert.deepEqual(
        leaky.map((l) => l.child),
        [],
        `这些叶分区仍能被 app_rw 改写（M-9 未回填，先跑 db:partition）：${leaky.map((l) => l.child).join(", ")}`,
    );

    const probeAfter = await cascadeProbe();
    console.log(`== AFTER 级联实证 == 删变体 deleted=${probeAfter.deleted} 流水剩余=${probeAfter.movementsLeft} err=${probeAfter.err || "-"}`);
    assert.equal(probeAfter.deleted, false, "收紧后删有流水的变体必须失败（实际删掉了 = 流水仍可被级联抹掉）");
    assert.match(probeAfter.err, /23503|foreign key|update or delete/, `失败原因应是外键拒绝，实际：${probeAfter.err}`);
    assert.equal(probeAfter.movementsLeft, 1, "被拒时流水必须原样存在");
    if (probeBefore.deleted !== true) {
        console.log("  ⚠ 改前那次删除也没成功 ⇒ BEFORE 没演示出级联（可能 order_items 已挡住），不影响 AFTER 的结论");
    }

    console.log(`== app_rw 实改凭证头 == ${await appRwProbe()}`);

    console.log("✅ HARDENING APPLIED + VERIFIED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
