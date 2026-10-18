import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
    createDb,
    legalEntities,
    markets,
    productVariants,
    products,
    updateVariantBasePrice,
    variantMarketPrices,
} from "@onestarry/db";
import { relayHandlers, runRelayBatch } from "./index";

/**
 * 改价端到端冒烟：updateVariantBasePrice(改真源+发事件) → runRelayBatch(重算) → 断言价格缓存=新基价。
 * 全程一个事务，最后回滚。运行：pnpm --filter @onestarry/jobs smoke:pricing
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `AP LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `ap_${suffix}`, name: "AP Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx
                .insert(productVariants)
                .values({ productId: prod!.id, sku: `AP-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" })
                .returning();

            // 改价：10000 → 15000（应更新真源 + 对市场发出 price.recompute 事件）
            const { emitted } = await updateVariantBasePrice(tx, { variantId: variant!.id, basePriceCents: 15000, changedBy: "smoke" });
            assert.ok(emitted >= 1, "应至少对一个市场发出重算事件");

            const v2 = (await tx.select().from(productVariants).where(eq(productVariants.id, variant!.id)).limit(1))[0];
            assert.equal(v2!.basePriceCents, 15000, "基价真源应已更新为 15000");

            // relay 消费待办 → 重算价格缓存
            const summary = await runRelayBatch(tx, relayHandlers, { limit: 500 });
            assert.ok(summary.succeeded >= 1, "relay 应成功处理重算事件");

            const [row] = await tx
                .select()
                .from(variantMarketPrices)
                .where(and(eq(variantMarketPrices.variantId, variant!.id), eq(variantMarketPrices.marketId, mk!.id)));
            assert.ok(row, "应写入 variant_market_prices");
            assert.equal(row.allInCents, 15000, "全包价应=新基价（税/关/运费均 0）");

            console.log(`✅ 改价端到端：真源 10000→15000，事件 ${emitted} 条，relay 重算 allIn=${row.allInCents}`);
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ ADMIN PRICING SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
