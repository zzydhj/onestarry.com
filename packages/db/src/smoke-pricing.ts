import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import { legalEntities, markets, priceHistory, products, productVariants, variantMarketPrices } from "./schema";
import { recomputeVariantMarketPrice } from "./queries";

/**
 * 定价重算冒烟：事务内建 legal_entity→market→product→variant，跑 recomputeVariantMarketPrice，
 * 验证 首建/命中跳过/改价写历史，最后回滚。运行：pnpm --filter @onestarry/db smoke:pricing
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Pricing LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `pr_${suffix}`, name: "Pricing Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `PR-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }).returning();

            const base = {
                variantId: variant!.id,
                marketId: mk!.id,
                baseCurrency: "USD",
                marketCurrency: "USD",
                fxRate: 1,
                shippingCents: 500,
                taxRate: 0.19,
                dutyRate: 0.1,
                pricingMode: "fixed_gross" as const,
                dutyPresentation: "included_in_price" as const,
                thresholdCents: 15000,
                overThresholdPolicy: "block" as const,
            };

            // 1) 首建
            const r1 = await recomputeVariantMarketPrice(tx, { ...base, basePriceCents: 10000 });
            assert.equal(r1.changed, true);
            assert.equal(r1.allInCents, 13685);
            assert.equal(r1.listPriceCents, 13685);
            assert.equal(r1.blocked, false);

            // 2) 相同输入 → 命中 inputs_hash 跳过
            const r2 = await recomputeVariantMarketPrice(tx, { ...base, basePriceCents: 10000 });
            assert.equal(r2.changed, false);

            // 3) 改基价 12000 → 重算 + 写 price_history
            const r3 = await recomputeVariantMarketPrice(tx, { ...base, basePriceCents: 12000, reason: "manual" });
            assert.equal(r3.changed, true);
            assert.equal(r3.allInCents, 16303);

            const [row] = await tx.select().from(variantMarketPrices).where(and(eq(variantMarketPrices.variantId, variant!.id), eq(variantMarketPrices.marketId, mk!.id)));
            assert.equal(row?.allInCents, 16303);
            assert.equal(row?.listPriceCents, 16303);

            const hist = await tx.select().from(priceHistory).where(and(eq(priceHistory.variantId, variant!.id), eq(priceHistory.marketId, mk!.id)));
            assert.equal(hist.length, 1, "改价应写 1 条 price_history");
            assert.equal(hist[0]?.oldListPriceCents, 13685);
            assert.equal(hist[0]?.newListPriceCents, 16303);

            console.log("✅ 定价重算：首建/命中跳过/改价写历史 全部通过");
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ PRICING SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
