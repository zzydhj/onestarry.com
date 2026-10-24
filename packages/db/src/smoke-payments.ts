import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { legalEntities, markets, orders, payments, products, productVariants, webhookEvents } from "./schema";

/**
 * 支付域冒烟：建单→建 payment→webhook 幂等接收（同 provider+event_id 二次插入被去重），最后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:payments
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Pay LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `py_${suffix}`, name: "Pay Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            await tx.insert(productVariants).values({ productId: prod!.id, sku: `PY-${suffix}` });
            const [order] = await tx
                .insert(orders)
                .values({ orderNumber: `PY-${suffix}`, publicToken: `tok-${suffix}`, email: "p@example.com", marketId: mk!.id, currency: "USD", totalCents: 26680 })
                .returning();

            const [pay] = await tx
                .insert(payments)
                .values({ orderId: order!.id, provider: "stripe", providerRef: `pi_${suffix}`, amountCents: 26680, currency: "USD" })
                .returning();
            assert.equal(pay?.status, "pending", "payment 默认 pending");

            // webhook 幂等：首次插入成功，重复 provider+event_id 被去重
            const evt = { provider: "stripe", providerEventId: `evt_${suffix}`, type: "payment_intent.succeeded", payload: { amount: 26680 } };
            const first = await tx.insert(webhookEvents).values(evt).onConflictDoNothing().returning();
            const second = await tx.insert(webhookEvents).values(evt).onConflictDoNothing().returning();
            assert.equal(first.length, 1, "首次 webhook 应入库");
            assert.equal(second.length, 0, "重复 webhook 应被唯一约束去重");

            const got = (await tx.select().from(payments).where(eq(payments.id, pay!.id)))[0];
            assert.equal(got?.amountCents, 26680);

            console.log(`✅ 支付域：建单+payment(pending)+webhook 幂等去重 全部通过`);
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ PAYMENTS SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
