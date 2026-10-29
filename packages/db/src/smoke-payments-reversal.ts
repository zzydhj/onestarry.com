import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb, type Tx } from "./client";
import {
    creditNotes,
    invoices,
    ledgerAccounts,
    ledgerEntries,
    legalEntities,
    markets,
    orders,
    payments,
    refunds,
} from "./schema";
import { recordPaymentReversal, recordPaymentSucceeded, seedLedgerAccounts } from "./queries";

/**
 * 支付**反向**落账冒烟：落账 → 部分退 → 补退到全额 → 重复退款去重；另起一单走撤销（revoked）。
 * 断言的都是钱的事：借贷必平、分摊按占比、红字凭证走独立序列、payment_status 走对、refundedCents 不双计。
 * 全程在一个事务里跑完再回滚，不留测试数据。
 * 运行：pnpm --filter @onestarry/db smoke:payments-reversal
 */
const ROLLBACK = Symbol("rollback");

type DbOrTx = Parameters<typeof recordPaymentReversal>[0];

/** 某笔 ledger 交易的借贷合计 —— 平不平只能真量，不能靠推理。 */
async function balance(db: DbOrTx, txnId: string) {
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, txnId));
    return {
        debit: rows.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountFunctional, 0),
        credit: rows.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amountFunctional, 0),
        count: rows.length,
    };
}

/** 取某笔交易里指定科目、指定方向的金额（验分摊是否按占比落对位置）。默认看借方。 */
async function amountOf(db: DbOrTx, txnId: string, code: string, direction: "debit" | "credit" = "debit") {
    const rows = await db
        .select({ code: ledgerAccounts.code, direction: ledgerEntries.direction, amount: ledgerEntries.amountFunctional })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(eq(ledgerEntries.transactionId, txnId));
    return rows.find((r) => r.code === code && r.direction === direction)?.amount ?? 0;
}

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    // 订单构成：货 20000 + 运费 500 + 税 4180 + 关 2000 = 26680（与 payments-posting 那份对齐）
    // 每个场景一个新法人：credit_note 序列是 per-legal-entity 的，混用会让连号断言失去意义。
    const makeOrder = async (tx: Tx, tag: string) => {
        const [le] = await tx
            .insert(legalEntities)
            .values({ jurisdiction: "US", displayName: `Rev LE ${suffix} ${tag}` })
            .returning();
        const [mk] = await tx
            .insert(markets)
            .values({ code: `rv_${tag}_${suffix}`, name: "Rev Mkt", currency: "USD", legalEntityId: le!.id })
            .returning();
        await seedLedgerAccounts(tx, le!.id);
        const [order] = await tx
            .insert(orders)
            .values({
                orderNumber: `RV-${tag}-${suffix}`,
                publicToken: `tok-${tag}-${suffix}`,
                email: "r@example.com",
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
        return { le: le!, order: order! };
    };

    try {
        await db.transaction(async (tx) => {
            /* ---------------- 路线一：部分退款 → 补退到全额 → 重复去重 ---------------- */
            const a = await makeOrder(tx, "a");
            const payA = await recordPaymentSucceeded(tx, { orderId: a.order.id, provider: "paypal", providerRef: `CAP-${suffix}A` });
            assert.ok((await tx.select().from(invoices).where(eq(invoices.orderId, a.order.id)))[0], "正向落账应已生发票");

            // 审查 L1（反向那一半）：退款事件报的币种与原收款不同 → 必须 REVERSAL_CURRENCY_MISMATCH。
            // 拿另一币种的数字冲这笔收款，错的是 refunded_cents 与红字凭证上的金额（钱数被换了种）。
            await assert.rejects(
                () =>
                    tx.transaction(async (sp) => {
                        await recordPaymentReversal(sp, {
                            provider: "paypal",
                            orderId: a.order.id,
                            captureRef: `CAP-${suffix}A`,
                            kind: "refunded",
                            amountCents: 100,
                            refundRef: `REF-${suffix}CUR`,
                            currency: "JPY",
                        });
                    }),
                /REVERSAL_CURRENCY_MISMATCH/,
                "币种不符的冲销必须被拒（否则就是在拿另一种钱的数字冲这笔收款）",
            );

            const half = await recordPaymentReversal(tx, {
                provider: "paypal",
                orderId: a.order.id,
                captureRef: `CAP-${suffix}A`,
                kind: "refunded",
                amountCents: 6670, // 恰为 1/4
                refundRef: `REF-${suffix}1`,
            });
            assert.equal(half.amountCents, 6670);
            assert.equal(half.full, false, "只退 1/4 不该判成全额");
            assert.equal(half.paymentStatus, "partially_refunded");
            assert.equal(half.creditNoteNumber, "CN-US-00000001", "红字凭证走独立序列，不占正式发票号");

            const b1 = await balance(tx, half.transactionId);
            assert.equal(b1.debit, b1.credit, "部分退款的红冲也必须借贷平");
            assert.equal(b1.debit, 6670, "借方合计应=本次冲销额");
            // 按占比摊：货+运费 20500×¼=5125、税 4180×¼=1045、关 2000×¼=500（和 6670）
            assert.equal(await amountOf(tx, half.transactionId, "customer_deposits"), 5125, "负债端该按原占比退回");
            assert.equal(await amountOf(tx, half.transactionId, "tax_payable"), 1045);
            assert.equal(await amountOf(tx, half.transactionId, "duty_collected"), 500);
            assert.equal(
                await amountOf(tx, half.transactionId, "psp_clearing"),
                0,
                "psp_clearing 在反向里是**贷方**，取借方必须是 0（方向写反这里立刻红）",
            );

            const rest = await recordPaymentReversal(tx, {
                provider: "paypal",
                orderId: a.order.id,
                captureRef: `CAP-${suffix}A`,
                kind: "refunded",
                amountCents: 26680 - 6670,
                refundRef: `REF-${suffix}2`,
            });
            assert.equal(rest.full, true, "补齐后应判全额");
            assert.equal(rest.paymentStatus, "refunded");
            assert.equal(rest.creditNoteNumber, "CN-US-00000002", "第二张红字凭证连号");

            // 同一笔退款的重复回调（换了 event_id，幂等键拦不住）必须被业务约束去重。
            // 用嵌套事务包：drizzle 在内层走 SAVEPOINT，预期它失败并只回滚到这一点。
            await assert.rejects(
                () =>
                    tx.transaction(async (sp) => {
                        await recordPaymentReversal(sp, {
                            provider: "paypal",
                            orderId: a.order.id,
                            captureRef: `CAP-${suffix}A`,
                            kind: "refunded",
                            amountCents: 100,
                            refundRef: `REF-${suffix}2`,
                        });
                    }),
                /PAYMENT_ALREADY_REVERSED/,
                "重复退款号必须被拒（否则同一笔钱退两次、账本虚增）",
            );
            // 超退也要拒
            await assert.rejects(
                () =>
                    tx.transaction(async (sp) => {
                        await recordPaymentReversal(sp, {
                            provider: "paypal",
                            orderId: a.order.id,
                            captureRef: `CAP-${suffix}A`,
                            kind: "refunded",
                            amountCents: 1,
                            refundRef: `REF-${suffix}9`,
                        });
                    }),
                /REVERSAL_AMOUNT_OVER/,
                "已全额退完再退 1 分也要拒",
            );

            const [payARow] = await tx.select().from(payments).where(eq(payments.id, payA.paymentId));
            assert.equal(payARow?.status, "refunded", "全额退完，这笔收款应标 refunded");
            assert.equal((await tx.select().from(refunds).where(eq(refunds.paymentId, payA.paymentId))).length, 2, "两笔退款都应留台账");
            const gotA = (await tx.select().from(orders).where(eq(orders.id, a.order.id)))[0];
            assert.equal(gotA?.refundedCents, 26680);
            assert.equal(gotA?.paymentStatus, "refunded");
            // 关键：退款不许把订单生命周期抹掉（货可能已寄出，得人工判）
            assert.equal(gotA?.status, "paid", "orders.status 不因退款回退");

            /* ---------------- 路线二：撤销（DENIED / REVERSED） ---------------- */
            const b = await makeOrder(tx, "b");
            const payB = await recordPaymentSucceeded(tx, { orderId: b.order.id, provider: "paypal", providerRef: `CAP-${suffix}B` });
            await tx.update(orders).set({ paypalOrderId: `PP-${suffix}B` }).where(eq(orders.id, b.order.id));

            const rev = await recordPaymentReversal(tx, {
                provider: "paypal",
                orderId: b.order.id,
                captureRef: `CAP-${suffix}B`,
                kind: "revoked",
                // 故意给一个错的额：撤销一律按全额冲，不能拿事件里那个「原额」当本次额
                amountCents: 1,
            });
            assert.equal(rev.amountCents, 26680, "撤销必须按全额冲");
            assert.equal(rev.paymentStatus, "unpaid", "钱被收回就该回到未付，让人能重付");
            const b2 = await balance(tx, rev.transactionId);
            assert.equal(b2.debit, b2.credit);
            assert.equal(b2.debit, 26680);

            const gotB = (await tx.select().from(orders).where(eq(orders.id, b.order.id)))[0];
            assert.equal(gotB?.paypalOrderId, null, "那张 PayPal 单已作废，必须清掉才能重付");
            assert.equal(gotB?.refundedCents, 0, "撤销不是退款，不该计入已退金额");
            const [payBRow] = await tx.select().from(payments).where(eq(payments.id, payB.paymentId));
            assert.equal(payBRow?.status, "failed");
            assert.equal((await tx.select().from(refunds).where(eq(refunds.paymentId, payB.paymentId))).length, 0, "撤销不该在 refunds 留行");
            assert.equal((await tx.select().from(creditNotes).where(eq(creditNotes.orderId, b.order.id))).length, 1, "撤销同样要出红字凭证");

            // 撤销过的单不能二次撤销
            await assert.rejects(
                () =>
                    tx.transaction(async (sp) => {
                        await recordPaymentReversal(sp, { provider: "paypal", orderId: b.order.id, captureRef: `CAP-${suffix}B`, kind: "revoked" });
                    }),
                /PAYMENT_ALREADY_REVERSED/,
                "已 failed 的收款不能再冲一次",
            );

            console.log("✅ 支付反向：分摊按占比、借贷平、红字凭证独立序列、重复与超退被拒、撤销不双计 全部通过");
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ PAYMENTS-REVERSAL SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
