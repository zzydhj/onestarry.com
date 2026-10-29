import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import {
    invoices,
    ledgerEntries,
    legalEntities,
    markets,
    orders,
    payments,
    transactionalOutbox,
} from "./schema";
import { recordPaymentSucceeded, seedLedgerAccounts } from "./queries";

/**
 * 支付落账冒烟：seed 科目→建单→recordPaymentSucceeded→断言借贷平衡/发票连号/订单转 paid/发事件，回滚。
 * 运行：pnpm --filter @onestarry/db smoke:payments-posting
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Post LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `po_${suffix}`, name: "Post Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [order] = await tx
                .insert(orders)
                .values({
                    orderNumber: `PO-${suffix}`,
                    publicToken: `tok-${suffix}`, // 访问凭证：列已 NOT NULL，绕过 createOrder 的写法要自己给
                    email: "p@example.com",
                    marketId: mk!.id,
                    currency: "USD",
                    subtotalCents: 20000,
                    taxCents: 4180,
                    dutyCents: 2000,
                    shippingCents: 500,
                    discountCents: 0,
                    totalCents: 26680,
                })
                .returning();

            await seedLedgerAccounts(tx, le!.id);

            // —— 审查 M-8 前提负向 ——
            // 金额与订单应付不符时，recordPaymentSucceeded 必须抛 PAYMENT_AMOUNT_MISMATCH（webhook 靠这条码
            // 把它归为「不可恢复」→ durably 记 event 行 + 回 200 停投，不再让 PSP 无谓重投 3 天）。
            // 并验证抛错发生在任何写入之前——不落 payment、不动账（钱安全）。
            let mismatchMsg = "";
            try {
                await recordPaymentSucceeded(tx, { orderId: order!.id, provider: "stripe", providerRef: `bad_${suffix}`, jurisdiction: "US", amountCents: 26000 });
            } catch (e) {
                mismatchMsg = e instanceof Error ? e.message : String(e);
            }
            assert.match(mismatchMsg, /PAYMENT_AMOUNT_MISMATCH/, `金额≠应付必须抛 PAYMENT_AMOUNT_MISMATCH（实际：${mismatchMsg || "没报错——分类前提不成立"}）`);
            const noBadPay = await tx.select({ id: payments.id }).from(payments).where(eq(payments.providerRef, `bad_${suffix}`));
            assert.equal(noBadPay.length, 0, "抛错应发生在写入前，不应留下任何 payment 行");
            console.log("✅ M-8 前提：金额不符抛 PAYMENT_AMOUNT_MISMATCH 且零写入（webhook 据此分类为不可恢复）");

            // —— 审查 L1：币种闸 ——
            // 金额对了不等于钱对了：0 位小数币种（JPY/KRW/VND）下“10000”是两种钱。
            // PSP 报的币种与订单币种不符必须抛 PAYMENT_CURRENCY_MISMATCH（webhook 据此归不可恢复：落档+停投）。
            let curMsg = "";
            try {
                await recordPaymentSucceeded(tx, { orderId: order!.id, provider: "stripe", providerRef: `badcur_${suffix}`, jurisdiction: "US", currency: "JPY" });
            } catch (e) {
                curMsg = e instanceof Error ? e.message : String(e);
            }
            assert.match(curMsg, /PAYMENT_CURRENCY_MISMATCH/, `币种不符必须抛 PAYMENT_CURRENCY_MISMATCH（实际：${curMsg || "没报错——币种闸失效"}）`);
            const noBadCur = await tx.select({ id: payments.id }).from(payments).where(eq(payments.providerRef, `badcur_${suffix}`));
            assert.equal(noBadCur.length, 0, "币种不符的落账不得留下 payment 行");
            console.log("✅ L1：币种不符抛 PAYMENT_CURRENCY_MISMATCH 且零写入");

            const res = await recordPaymentSucceeded(tx, {
                orderId: order!.id,
                provider: "stripe",
                providerRef: `pi_${suffix}`,
                // 用小写对照：闸必须是大写归一比较，否则库里合法的 "usd" 会把真钱拒在门外。
                currency: "usd",
                jurisdiction: "US",
            });

            assert.equal(res.invoiceNumber, "US-00000001", "首张发票号应为 US-00000001");

            // 借贷平衡
            const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, res.transactionId));
            const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountFunctional, 0);
            const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amountFunctional, 0);
            assert.equal(debit, credit, "借贷必须相等");
            assert.equal(debit, 26680, "借方合计应=收款额");
            assert.equal(entries.length, 4, "应有 4 条分录（1借3贷）");

            // 订单转 paid
            const gotOrder = (await tx.select().from(orders).where(eq(orders.id, order!.id)))[0];
            assert.equal(gotOrder?.status, "paid");
            assert.equal(gotOrder?.paymentStatus, "paid");

            // 发票存在 + payment succeeded
            const inv = (await tx.select().from(invoices).where(eq(invoices.invoiceNumber, res.invoiceNumber)))[0];
            assert.ok(inv, "发票应已建");
            const pay = (await tx.select().from(payments).where(eq(payments.id, res.paymentId)))[0];
            assert.equal(pay?.status, "succeeded");

            // 事件
            const evs = await tx
                .select()
                .from(transactionalOutbox)
                .where(and(eq(transactionalOutbox.aggregateType, "payment"), eq(transactionalOutbox.aggregateId, res.paymentId)));
            assert.ok(evs.length >= 1, "应发 payment.succeeded 事件");

            console.log(`✅ 支付落账：借贷平衡(${debit}=${credit})、发票 ${res.invoiceNumber}、订单转 paid、已发事件`);

            // —— P1：并发/重复收款防护的负向验证（与 C-1 发货同构） ——
            // 1) 应用层守卫：对已 paid 的单再落一次 → 必须 PAYMENT_ALREADY_RECORDED。
            let guardMsg = "";
            try {
                await recordPaymentSucceeded(tx, { orderId: order!.id, provider: "stripe", providerRef: `pi2_${suffix}`, jurisdiction: "US" });
            } catch (e) {
                guardMsg = e instanceof Error ? e.message : String(e);
            }
            assert.match(guardMsg, /PAYMENT_ALREADY_RECORDED/, `二次落账应被守卫拒（实际：${guardMsg || "没报错——守卫失效"}）`);

            // 2) 对照：同单插一笔非 succeeded（failed）应放行 → 证明下面索引只锁 succeeded，非整单唯一。
            await tx.insert(payments).values({ orderId: order!.id, provider: "stripe", providerRef: `fail_${suffix}`, amountCents: 100, currency: "USD", status: "failed" });

            // 3) 数据库层兜底：直插第二张 succeeded（模拟越过应用层检查的并发）→ 必须被 pay_order_succeeded_uq 拒。
            //    23505 会 abort 事务，之后不能再跑 SQL，故这是本事务最后一步断言。
            let violated = false;
            let info = "";
            try {
                await tx.insert(payments).values({ orderId: order!.id, provider: "stripe", providerRef: `dup_${suffix}`, amountCents: 26680, currency: "USD", status: "succeeded" });
            } catch (e) {
                violated = true;
                const anyErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
                info = `code=${anyErr.code ?? anyErr.cause?.code ?? ""} constraint=${anyErr.constraint ?? anyErr.cause?.constraint ?? ""}`;
            }
            assert.ok(violated, `同单第二笔 succeeded 必须被唯一索引拒掉（否则 P1 未生效）：${info}`);
            assert.ok(info.includes("23505") || /pay_order_succeeded_uq/i.test(info), `应因 pay_order_succeeded_uq 拒掉，实际：${info}`);
            console.log("✅ P1：二次落账被 PAYMENT_ALREADY_RECORDED 挡；failed 放行、第二笔 succeeded 被 pay_order_succeeded_uq 拒");

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ PAYMENTS-POSTING SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
