import { and, eq } from "drizzle-orm";
import { computeLandedPrice, hashInputs } from "@onestarry/core";
import { markets, priceHistory, productVariants, variantMarketPrices } from "../schema";
import { emitEvent } from "./outbox";
import type { Db, Tx } from "../client";

export interface RecomputeInput {
    variantId: string;
    marketId: string;
    basePriceCents: number; // 来自 variant.basePriceCents（售价真源）
    baseCurrency: string;
    fxRate: number; // base → market
    marketCurrency: string;
    shippingCents: number;
    taxRate: number;
    dutyRate: number;
    pricingMode: "fixed_gross" | "net_plus_tax";
    dutyPresentation: "separate_line" | "included_in_price";
    thresholdCents: number | null;
    overThresholdPolicy: "block" | "switch_to_ddp" | "ddu_warn";
    reason?: "manual" | "promotion" | "duty_recalc" | "fx_recalc";
    changedBy?: string | null;
}

export interface RecomputeResult {
    changed: boolean;
    blocked: boolean;
    allInCents: number;
    listPriceCents: number;
}

/**
 * 重算并落库某 (variant, market) 的全包价缓存。
 * inputs_hash 命中则跳过（幂等、省写）；list 价变化则写 price_history（Omnibus）。
 * 上层（Inngest relay / Admin 改价）负责解析 税率/关税率/汇率 后调用。
 */
export async function recomputeVariantMarketPrice(db: Db | Tx, input: RecomputeInput): Promise<RecomputeResult> {
    const goodsValueCents = Math.round(input.basePriceCents * input.fxRate);
    const landed = computeLandedPrice({
        goodsValueCents,
        shippingCents: input.shippingCents,
        taxRate: input.taxRate,
        dutyRate: input.dutyRate,
        pricingMode: input.pricingMode,
        dutyPresentation: input.dutyPresentation,
        thresholdCents: input.thresholdCents,
        overThresholdPolicy: input.overThresholdPolicy,
    });

    const inputsHash = hashInputs({
        basePriceCents: input.basePriceCents,
        baseCurrency: input.baseCurrency,
        fxRate: input.fxRate,
        marketCurrency: input.marketCurrency,
        shippingCents: input.shippingCents,
        taxRate: input.taxRate,
        dutyRate: input.dutyRate,
        pricingMode: input.pricingMode,
        dutyPresentation: input.dutyPresentation,
        thresholdCents: input.thresholdCents,
        overThresholdPolicy: input.overThresholdPolicy,
    });

    const existing = (
        await db
            .select()
            .from(variantMarketPrices)
            .where(and(eq(variantMarketPrices.variantId, input.variantId), eq(variantMarketPrices.marketId, input.marketId)))
            .limit(1)
    )[0];

    if (existing && existing.inputsHash === inputsHash) {
        return { changed: false, blocked: landed.blocked, allInCents: landed.allInCents, listPriceCents: landed.displayedPriceCents };
    }

    const now = new Date();
    const row = {
        variantId: input.variantId,
        marketId: input.marketId,
        currency: input.marketCurrency,
        goodsCents: goodsValueCents,
        shippingCents: input.shippingCents,
        dutyCents: landed.dutyCents,
        taxCents: landed.taxCents,
        listPriceCents: landed.displayedPriceCents,
        allInCents: landed.allInCents,
        blocked: landed.blocked,
        pricingMode: input.pricingMode,
        dutyPresentation: input.dutyPresentation,
        fxRate: String(input.fxRate),
        inputsHash,
        computedAt: now,
    };

    await db.insert(variantMarketPrices).values(row).onConflictDoUpdate({
        target: [variantMarketPrices.variantId, variantMarketPrices.marketId],
        set: {
            currency: row.currency,
            goodsCents: row.goodsCents,
            shippingCents: row.shippingCents,
            dutyCents: row.dutyCents,
            taxCents: row.taxCents,
            listPriceCents: row.listPriceCents,
            allInCents: row.allInCents,
            blocked: row.blocked,
            pricingMode: row.pricingMode,
            dutyPresentation: row.dutyPresentation,
            fxRate: row.fxRate,
            inputsHash,
            computedAt: now,
            updatedAt: now,
        },
    });

    // list 价变化 → 写价格历史（首建不算变更，不写）
    if (existing && existing.listPriceCents !== landed.displayedPriceCents) {
        await db.insert(priceHistory).values({
            variantId: input.variantId,
            marketId: input.marketId,
            currency: input.marketCurrency,
            oldListPriceCents: existing.listPriceCents,
            newListPriceCents: landed.displayedPriceCents,
            reason: input.reason ?? "manual",
            changedBy: input.changedBy ?? null,
        });
    }

    return { changed: true, blocked: landed.blocked, allInCents: landed.allInCents, listPriceCents: landed.displayedPriceCents };
}

export interface UpdateBasePriceInput {
    variantId: string;
    basePriceCents: number;
    changedBy?: string | null;
}

/**
 * 对当前所有市场发出 price.recompute 事件（payload 为完整 RecomputeInput，与 seed 一致）。
 * 改价与新建商品共用。税/关/运费 provider 未接入 → 0/1 占位。
 */
export async function emitPriceRecomputeForAllMarkets(
    db: Db | Tx,
    input: { variantId: string; basePriceCents: number; baseCurrency: string; changedBy?: string | null },
): Promise<{ emitted: number }> {
    const allMarkets = await db.select().from(markets);
    for (const m of allMarkets) {
        const payload: RecomputeInput = {
            variantId: input.variantId,
            marketId: m.id,
            basePriceCents: input.basePriceCents,
            baseCurrency: input.baseCurrency,
            fxRate: 1, // MVP：基价币种==市场币种；FX provider 待接
            marketCurrency: m.currency,
            shippingCents: 0, // ShippingProvider 待接
            taxRate: 0, // TaxProvider 待接
            dutyRate: 0, // DutyProvider 待接
            pricingMode: m.pricingMode,
            dutyPresentation: m.dutyPresentation,
            thresholdCents: null, // deMinimis provider 待接
            overThresholdPolicy: m.overThresholdPolicy,
            reason: "manual",
            changedBy: input.changedBy ?? null,
        };
        await emitEvent(db, {
            aggregateType: "variant",
            aggregateId: input.variantId,
            eventType: "price.recompute",
            payload,
        });
    }
    return { emitted: allMarkets.length };
}

/**
 * 改某变体的售价真源 basePriceCents，并对所有市场发出 price.recompute 事件（与主写同事务）。
 * 调用方负责：包在事务里 + 提交后 ctx.waitUntil(runRelayBatch(...)) 即时派发（Cron 每分钟兜底）。
 */
export async function updateVariantBasePrice(db: Db | Tx, input: UpdateBasePriceInput): Promise<{ emitted: number }> {
    const variant = (await db.select().from(productVariants).where(eq(productVariants.id, input.variantId)).limit(1))[0];
    if (!variant) throw new Error(`variant ${input.variantId} 不存在`);

    await db
        .update(productVariants)
        .set({ basePriceCents: input.basePriceCents, updatedAt: new Date() })
        .where(eq(productVariants.id, input.variantId));

    return emitPriceRecomputeForAllMarkets(db, {
        variantId: variant.id,
        basePriceCents: input.basePriceCents,
        baseCurrency: variant.baseCurrency,
        changedBy: input.changedBy,
    });
}
