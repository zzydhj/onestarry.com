import { and, eq } from "drizzle-orm";
import { computeLandedPrice, hashInputs } from "@onestarry/core";
import { priceHistory, variantMarketPrices } from "../schema";
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
