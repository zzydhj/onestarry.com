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

            const res = await recordPaymentSucceeded(tx, {
                orderId: order!.id,
                provider: "stripe",
                providerRef: `pi_${suffix}`,
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
