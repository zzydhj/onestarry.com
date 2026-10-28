import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "./client";
import { legalDocuments } from "./schema";
import { upsertLegalDoc } from "./queries";

/**
 * legal_documents「唯一 current」冒烟（审查 M-2 的真验证）：证明 ld_current_uq 部分唯一索引
 * （(type, locale, coalesce(market_id,零值)) WHERE is_current）对全球级文档（marketId=NULL）真生效——
 * 旧的可空列唯一索引约不住 NULL，并发双保存会插出两条 isCurrent=true、getLegalDoc limit(1) 无排序随机展示。
 * 断言：① 同 scope 两次 upsert 只剩 1 个 current 且是最近正文；② 绕过 upsert 直插第二条 current → 23505。
 * 全程一事务，最后回滚。运行：pnpm --filter @onestarry/db smoke:legal
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const scope = and(eq(legalDocuments.type, "privacy"), eq(legalDocuments.locale, "en"), isNull(legalDocuments.marketId), eq(legalDocuments.isCurrent, true));

    try {
        await db.transaction(async (tx) => {
            await upsertLegalDoc(tx, { type: "privacy", locale: "en", body: "v1" });
            await upsertLegalDoc(tx, { type: "privacy", locale: "en", body: "v2" });

            const rows = await tx.select({ id: legalDocuments.id, body: legalDocuments.body }).from(legalDocuments).where(scope);
            assert.equal(rows.length, 1, `两次 upsert 后只应 1 个 current，实际 ${rows.length} 个`);
            assert.equal(rows[0]?.body, "v2", "应保留最近正文");
            console.log(`✅ M-2：两次 upsert 收敛成 1 个 current、正文取最近（${rows[0]?.body}）`);

            let violated = false;
            let info = "";
            try {
                await tx.insert(legalDocuments).values({ type: "privacy", locale: "en", marketId: null, version: 9, body: "dup", isCurrent: true });
            } catch (e) {
                violated = true;
                const anyErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
                info = `code=${anyErr.code ?? anyErr.cause?.code ?? ""} constraint=${anyErr.constraint ?? anyErr.cause?.constraint ?? ""}`;
            }
            assert.ok(violated, `第二个 current 行必须被 ld_current_uq 拒掉（否则 M-2 未生效）：${info}`);
            assert.ok(info.includes("23505") || /ld_current_uq/i.test(info), `应因 ld_current_uq 拒掉，实际：${info}`);
            console.log(`✅ M-2：直插第二个 current 被部分唯一索引拒（${info}）`);

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ LEGAL SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
