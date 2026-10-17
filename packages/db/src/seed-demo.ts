import { config } from "dotenv";
config({ path: "../../.env.local" });

import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { inventory, legalEntities, markets, productTranslations, products, productVariants, slugs } from "./schema";
import { recomputeVariantMarketPrice, type RecomputeInput } from "./queries";

/**
 * 演示数据 seed（MVP-0 纵切用，真实提交、非回滚）。幂等：已存在 us 市场则跳过。
 * 运行：pnpm --filter @onestarry/db seed:demo
 */
const DEMO = [
    { slug: "ceramic-mug", title: "Ceramic Mug", desc: "A warm 350ml stoneware mug.", price: 1299, cost: 400, weight: 350, stock: 120 },
    { slug: "linen-tote", title: "Linen Tote Bag", desc: "Durable natural linen everyday tote.", price: 2499, cost: 900, weight: 220, stock: 80 },
    { slug: "steel-bottle", title: "Insulated Steel Bottle", desc: "Keeps drinks cold 24h, 500ml.", price: 1999, cost: 700, weight: 400, stock: 200 },
];

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);

    const existing = (await db.select({ id: markets.id }).from(markets).where(eq(markets.code, "us")).limit(1))[0];
    if (existing) {
        console.log("↷ 演示数据已存在（us 市场在），跳过。");
        return;
    }

    const [le] = await db.insert(legalEntities).values({ jurisdiction: "US", displayName: "OneStarry LLC (demo)" }).returning();
    const [mk] = await db
        .insert(markets)
        .values({ code: "us", name: "United States", currency: "USD", legalEntityId: le!.id, pricingMode: "net_plus_tax", dutyPresentation: "separate_line" })
        .returning();

    for (const d of DEMO) {
        const [prod] = await db.insert(products).values({ status: "active" }).returning();
        const [variant] = await db
            .insert(productVariants)
            .values({ productId: prod!.id, sku: `DEMO-${d.slug.toUpperCase()}`, basePriceCents: d.price, baseCurrency: "USD", costCents: d.cost, weightG: d.weight, isPrimary: true })
            .returning();
        await db.insert(inventory).values({ variantId: variant!.id, onHand: d.stock, reserved: 0 });
        await db.insert(slugs).values({ entityType: "product", entityId: prod!.id, locale: "en", slug: d.slug, isCurrent: true });
        await db.insert(productTranslations).values({ productId: prod!.id, locale: "en", title: d.title, description: d.desc });

        const priceInput: RecomputeInput = {
            variantId: variant!.id,
            marketId: mk!.id,
            basePriceCents: d.price,
            baseCurrency: "USD",
            fxRate: 1,
            marketCurrency: "USD",
            shippingCents: 0,
            taxRate: 0,
            dutyRate: 0,
            pricingMode: "net_plus_tax",
            dutyPresentation: "separate_line",
            thresholdCents: null,
            overThresholdPolicy: "block",
        };
        await recomputeVariantMarketPrice(db, priceInput);
    }

    console.log(`✅ 已 seed 演示数据：us 市场 + ${DEMO.length} 个商品（含全包价缓存/库存/slug/文案）`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
