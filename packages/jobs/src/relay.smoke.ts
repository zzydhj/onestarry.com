import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
    createDb,
    emitEvent,
    legalEntities,
    markets,
    products,
    productVariants,
    variantMarketPrices,
    type RecomputeInput,
} from "@onestarry/db";
import { relayHandlers, runRelayBatch } from "./index";

/**
 * relay 端到端冒烟：emit(price.recompute) → runRelayBatch 消费 → 断言 variant_market_prices 被重算写入。
 * 全程在一个事务里，最后回滚。运行：pnpm --filter @onestarry/jobs smoke
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Relay LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `rl_${suffix}`, name: "Relay Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `RL-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }).returning();

            const input: RecomputeInput = {
                variantId: variant!.id,
                marketId: mk!.id,
                basePriceCents: 10000,
                baseCurrency: "USD",
                fxRate: 1,
                marketCurrency: "USD",
                shippingCents: 500,
                taxRate: 0.19,
                dutyRate: 0.1,
                pricingMode: "fixed_gross",
                dutyPresentation: "included_in_price",
                thresholdCents: 15000,
                overThresholdPolicy: "block",
            };

            // 发起方：业务写事务内落一条待办事件
            await emitEvent(tx, { aggregateType: "variant", aggregateId: variant!.id, eventType: "price.recompute", payload: input });

            // relay：消费待办 → 命中 price.recompute 处理器 → 重算并写缓存
            const summary = await runRelayBatch(tx, relayHandlers, { limit: 500 });
            assert.ok(summary.succeeded >= 1, "至少应成功处理我们这条事件");

            const [row] = await tx
                .select()
                .from(variantMarketPrices)
                .where(and(eq(variantMarketPrices.variantId, variant!.id), eq(variantMarketPrices.marketId, mk!.id)));
            assert.ok(row, "relay 应已写入 variant_market_prices");
            assert.equal(row.allInCents, 13685, "全包价应由 relay 重算得出");

            console.log(`✅ relay 端到端：事件被消费，缓存重算 allIn=${row.allInCents}（succeeded=${summary.succeeded}）`);
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ RELAY SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
