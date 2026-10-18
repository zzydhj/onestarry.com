import { and, eq } from "drizzle-orm";
import { inventory, productTranslations, productVariants, products, slugs } from "../schema";
import { emitPriceRecomputeForAllMarkets } from "./pricing";
import { setVariantOnHand } from "./inventory";
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

/** 保存商品的图文详情（ProseMirror JSON）到指定语言译文行（行必存在，由新建时创建）。 */
export async function setProductRichBody(
    db: Db | Tx,
    input: { productId: string; richBody: Record<string, unknown> | null; locale?: string },
): Promise<void> {
    const locale = input.locale ?? "en";
    await db
        .update(productTranslations)
        .set({ richBody: input.richBody, updatedAt: new Date() })
        .where(and(eq(productTranslations.productId, input.productId), eq(productTranslations.locale, locale)));
}

function slugify(s: string): string {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `p-${Date.now()}`;
}

export interface ImportRowInput {
    sku: string;
    slug?: string | null;
    title?: string | null;
    description?: string | null;
    basePriceCents?: number | null;
    costCents?: number | null;
    weightG?: number | null;
    onHand?: number | null;
    status?: "draft" | "active" | "archived" | null;
    locale?: string;
    changedBy?: string | null;
}

/**
 * 按 SKU upsert 一行商品：存在则只更新提供的字段（价/成本/重/库存/状态/文案）；不存在则新建。
 * 两者都会（直接或经由新建）发出 price.recompute；调用方最后 runRelayBatch 统一重算。
 * 每行建议单独事务（一行失败不回滚整批）。
 */
export async function upsertProductFromRow(db: Db | Tx, input: ImportRowInput): Promise<{ action: "created" | "updated"; productId: string }> {
    const locale = input.locale ?? "en";
    const existing = (await db.select().from(productVariants).where(eq(productVariants.sku, input.sku)).limit(1))[0];

    if (existing) {
        const productId = existing.productId;
        if (input.basePriceCents != null || input.costCents != null || input.weightG != null) {
            await db
                .update(productVariants)
                .set({
                    ...(input.basePriceCents != null ? { basePriceCents: input.basePriceCents } : {}),
                    ...(input.costCents != null ? { costCents: input.costCents } : {}),
                    ...(input.weightG != null ? { weightG: input.weightG } : {}),
                    updatedAt: new Date(),
                })
                .where(eq(productVariants.id, existing.id));
        }
        if (input.status) {
            await db.update(products).set({ status: input.status, updatedAt: new Date() }).where(eq(products.id, productId));
        }
        if (input.onHand != null) {
            await setVariantOnHand(db, { variantId: existing.id, onHand: input.onHand, note: "import", changedBy: input.changedBy });
        }
        if (input.title || input.description) {
            const [tr] = await db
                .select({ id: productTranslations.id })
                .from(productTranslations)
                .where(and(eq(productTranslations.productId, productId), eq(productTranslations.locale, locale)))
                .limit(1);
            if (tr) {
                await db
                    .update(productTranslations)
                    .set({
                        ...(input.title ? { title: input.title } : {}),
                        ...(input.description ? { description: input.description } : {}),
                        updatedAt: new Date(),
                    })
                    .where(eq(productTranslations.id, tr.id));
            }
        }
        const basePrice = input.basePriceCents ?? existing.basePriceCents;
        if (basePrice != null) {
            await emitPriceRecomputeForAllMarkets(db, {
                variantId: existing.id,
                basePriceCents: basePrice,
                baseCurrency: existing.baseCurrency,
                changedBy: input.changedBy,
            });
        }
        return { action: "updated", productId };
    }

    const title = input.title || input.sku;
    const created = await createProductWithVariant(db, {
        sku: input.sku,
        slug: input.slug || slugify(title),
        title,
        description: input.description ?? null,
        basePriceCents: input.basePriceCents ?? 0,
        costCents: input.costCents ?? null,
        weightG: input.weightG ?? null,
        onHand: input.onHand ?? 0,
        status: input.status ?? "draft",
        locale,
        changedBy: input.changedBy,
    });
    return { action: "created", productId: created.productId };
}
