/**
 * core/shipping.ts —— 运费计算单一函数（§6.6 / §15 步骤 9-11）
 *
 * 纯函数、零依赖：结账/后台试算共用。上层按整单聚合总重 + 目的国→zone→carrier 选出 rateCard 后调用。
 * - 计费重 = max(实际重, 体积重)；体积重(kg)=长×宽×高(cm)/divisor（默认 5000）。
 * - mode：weight_tier（按重量档，超出最重档按 overKgCents/公斤）| per_kg | flat。
 * - registrationCents 叠加；goodsValueCents ≥ freeOverCents 免运费（返回 0）。
 * 返回的 shippingCents 由调用方作为 shippingCents 传入 computeLandedPrice（运费进 VAT 税基）。
 */

/**
 * MVP 占位运费（分）：`computeShipping` 与 `shipping_rates` 尚未接进结账（D03/N3）前的固定值。
 * 单一真源：购物车展示、结账页展示、`createOrder` 落账三处都读这一个常量——保证“看到的运费 == 实收的运费”，
 * 不会因为各自写死 500 而漂移。接上真实 `computeShipping` 后删掉本常量，三处改调用同一个算得的 shippingCents。
 */
export const PLACEHOLDER_SHIPPING_CENTS = 500;

export type ShippingMode = "weight_tier" | "per_kg" | "flat";

export interface ShippingTier {
    upToG: number;
    priceCents: number;
}

export interface RateCard {
    currency: string;
    mode: ShippingMode;
    tiers?: ShippingTier[];
    overKgCents?: number;
    registrationCents?: number;
    freeOverCents?: number;
    perKgCents?: number;
    flatCents?: number;
    divisor?: number;
}

export interface DimsCm {
    l: number;
    w: number;
    h: number;
}

export interface ShippingResult {
    chargeableWeightG: number;
    shippingCents: number;
    currency: string;
    free: boolean;
}

export function computeShipping(
    card: RateCard,
    weightG: number,
    dimsCm?: DimsCm,
    goodsValueCents = 0,
): ShippingResult {
    if (card.freeOverCents != null && goodsValueCents >= card.freeOverCents) {
        return { chargeableWeightG: weightG, shippingCents: 0, currency: card.currency, free: true };
    }

    let chargeable = weightG;
    if (dimsCm) {
        const divisor = card.divisor ?? 5000;
        const volumetricG = Math.round(((dimsCm.l * dimsCm.w * dimsCm.h) / divisor) * 1000);
        chargeable = Math.max(weightG, volumetricG);
    }

    let price = 0;
    if (card.mode === "flat") {
        price = card.flatCents ?? 0;
    } else if (card.mode === "per_kg") {
        price = Math.ceil(chargeable / 1000) * (card.perKgCents ?? 0);
    } else {
        const tiers = (card.tiers ?? []).slice().sort((a, b) => a.upToG - b.upToG);
        const hit = tiers.find((t) => chargeable <= t.upToG);
        if (hit) {
            price = hit.priceCents;
        } else if (tiers.length) {
            const last = tiers[tiers.length - 1]!;
            const extraKg = Math.ceil((chargeable - last.upToG) / 1000);
            price = last.priceCents + extraKg * (card.overKgCents ?? 0);
        }
    }

    price += card.registrationCents ?? 0;
    return { chargeableWeightG: chargeable, shippingCents: price, currency: card.currency, free: false };
}
