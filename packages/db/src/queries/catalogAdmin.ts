import { inventory, productTranslations, productVariants, products, slugs } from "../schema";
import { emitPriceRecomputeForAllMarkets } from "./pricing";
import type { Db, Tx } from "../client";

export interface CreateProductInput {
    sku: string;
    slug: string;
    title: string;
    description?: string | null;
    basePriceCents: number;
    baseCurrency?: string;
    costCents?: number | null;
    weightG?: number | null;
    onHand: number;
    status: "draft" | "active" | "archived";
    locale?: string;
    changedBy?: string | null;
}

export interface CreateProductResult {
    productId: string;
    variantId: string;
}

/**
 * 新建一个最小可售卖商品：product + 主变体 + 库存 + slug + 文案，并对所有市场发出 price.recompute。
 * 调用方负责包事务 + 提交后 ctx.waitUntil(runRelayBatch) 即时算价（Cron 兜底）。
 * sku / slug 唯一约束冲突会抛错（由上层捕获）。
 */
export async function createProductWithVariant(db: Db | Tx, input: CreateProductInput): Promise<CreateProductResult> {
    const locale = input.locale ?? "en";
    const baseCurrency = input.baseCurrency ?? "USD";

    const [prod] = await db.insert(products).values({ status: input.status }).returning();
    const [variant] = await db
        .insert(productVariants)
        .values({
            productId: prod!.id,
            sku: input.sku,
            basePriceCents: input.basePriceCents,
            baseCurrency,
            costCents: input.costCents ?? null,
            weightG: input.weightG ?? null,
            isPrimary: true,
        })
        .returning();
    await db.insert(inventory).values({ variantId: variant!.id, onHand: input.onHand, reserved: 0 });
    await db
        .insert(slugs)
        .values({ entityType: "product", entityId: prod!.id, locale, slug: input.slug, isCurrent: true });
    await db
        .insert(productTranslations)
        .values({ productId: prod!.id, locale, title: input.title, description: input.description ?? null });

    await emitPriceRecomputeForAllMarkets(db, {
        variantId: variant!.id,
        basePriceCents: input.basePriceCents,
        baseCurrency,
        changedBy: input.changedBy,
    });

    return { productId: prod!.id, variantId: variant!.id };
}
