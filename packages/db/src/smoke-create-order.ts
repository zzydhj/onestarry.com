import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { legalEntities, markets, orderLines, products, productVariants, transactionalOutbox } from "./schema";
import { createOrder, recomputeVariantMarketPrice, type RecomputeInput } from "./queries";

/**
 * 结账服务冒烟：先算出 variant 全包价缓存 → createOrder → 断言订单/明细/发 outbox 事件 + 幂等重放拦截，最后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:create-order
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `CO LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `co_${suffix}`, name: "CO Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `CO-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }).returning();

            // 先建全包价缓存（重算时 shipping=0）
            const priceInput: RecomputeInput = {
                variantId: variant!.id,
                marketId: mk!.id,
                basePriceCents: 10000,
                baseCurrency: "USD",
                fxRate: 1,
                marketCurrency: "USD",
                shippingCents: 0,
                taxRate: 0.19,
                dutyRate: 0.1,
                pricingMode: "fixed_gross",
                dutyPresentation: "included_in_price",
                thresholdCents: 15000,
                overThresholdPolicy: "block",
            };
            await recomputeVariantMarketPrice(tx, priceInput);

            // 下单：2 件 + 整单运费 500
            const result = await createOrder(tx, {
                idempotencyKey: `idem-${suffix}`,
                email: "buyer@example.com",
                marketId: mk!.id,
                currency: "USD",
                shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
                items: [{ variantId: variant!.id, quantity: 2 }],
                shippingCents: 500,
            });

            // 期望：goods 20000 + tax 4180 + duty 2000 + shipping 500 = 26680
            assert.equal(result.totalCents, 26680, "订单总额应为 26680");

            const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, result.orderId));
            const lineSum = lines.reduce((s, l) => s + l.amountCents, 0);
            assert.equal(lines.length, 4, "应有 item/shipping/tax/duty 4 条明细");
            assert.equal(lineSum, 26680, "明细求和应等于总额");

            const evs = await tx
                .select({ c: sql<number>`count(*)::int` })
                .from(transactionalOutbox)
                .where(and(eq(transactionalOutbox.aggregateType, "order"), eq(transactionalOutbox.aggregateId, result.orderId)));
            assert.ok((evs[0]?.c ?? 0) >= 1, "应发出 order.created 事件");

            // 幂等：相同 key 重放应被拦
            let threw = false;
            try {
                await createOrder(tx, {
                    idempotencyKey: `idem-${suffix}`,
                    email: "buyer@example.com",
                    marketId: mk!.id,
                    currency: "USD",
                    shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
                    items: [{ variantId: variant!.id, quantity: 2 }],
                    shippingCents: 500,
                });
            } catch (e) {
                threw = (e as Error).message === "IDEMPOTENT_REPLAY";
            }
            assert.ok(threw, "相同幂等键重放应被拦截");

            console.log(`✅ 结账：建单 ${result.orderNumber} 总=${result.totalCents}，4 明细求和一致，已发 order.created，幂等重放已拦`);
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ CREATE-ORDER SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
