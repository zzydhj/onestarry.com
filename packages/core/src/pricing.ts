/**
 * core/pricing.ts —— 全包价（landed cost）计算单一入口（§15 步骤 9 / §5）
 *
 * 纯函数、零依赖：调用方（重算 job、结账、PDP）把事实（货值/运费/税率/关税率/市场策略）传入。
 * - allInCents：客户最终实付 = 货值 + 运费 + 关税 + 消费税（DDP 恒定）。
 * - displayedPriceCents：PDP 展示价，随 pricingMode（税是否含）与 dutyPresentation（关税是否含）变化。
 * - 超每票阈值（EU €150 / UK £135）且 policy=block → 拦截（IOSS 不可用）。
 * 说明：这是 MVP 简化模型；Stripe Tax / LandedCostProvider 接入后细化，但口径与此一致。
 */

export type PricingMode = "fixed_gross" | "net_plus_tax";
export type DutyPresentation = "separate_line" | "included_in_price";
export type OverThresholdPolicy = "block" | "switch_to_ddp" | "ddu_warn";

export interface LandedPriceInput {
    /** 货值净额（分），决定关税与阈值判定（不含运费）。 */
    goodsValueCents: number;
    shippingCents: number;
    /** 消费税率 0..1（如 0.19）。 */
    taxRate: number;
    /** 关税率 0..1（如 0.10）。 */
    dutyRate: number;
    pricingMode: PricingMode;
    dutyPresentation: DutyPresentation;
    /** 每票货物价值阈值（分）；null=该市场无阈值。 */
    thresholdCents: number | null;
    overThresholdPolicy: OverThresholdPolicy;
}

export interface LandedPriceResult {
    blocked: boolean;
    reason: "over_threshold" | null;
    goodsCents: number;
    shippingCents: number;
    dutyCents: number;
    taxCents: number;
    /** 客户实付全包价（DDP）。 */
    allInCents: number;
    /** PDP 展示价（依 pricingMode / dutyPresentation 决定含税/含关税）。 */
    displayedPriceCents: number;
}

export function computeLandedPrice(input: LandedPriceInput): LandedPriceResult {
    const goods = input.goodsValueCents;
    const shipping = input.shippingCents;

    // 超阈值且策略为 block → 拦截（IOSS 不可用于超 €150/£135 的单票）。
    if (input.thresholdCents != null && goods > input.thresholdCents && input.overThresholdPolicy === "block") {
        return {
            blocked: true,
            reason: "over_threshold",
            goodsCents: goods,
            shippingCents: shipping,
            dutyCents: 0,
            taxCents: 0,
            allInCents: 0,
            displayedPriceCents: 0,
        };
    }

    const duty = Math.round(goods * input.dutyRate);
    // 进口增值税典型计税基：货值 + 运费 + 关税。
    const tax = Math.round((goods + shipping + duty) * input.taxRate);
    const allIn = goods + shipping + duty + tax;

    let displayed = goods + shipping;
    if (input.dutyPresentation === "included_in_price") displayed += duty;
    if (input.pricingMode === "fixed_gross") displayed += tax;

    return {
        blocked: false,
        reason: null,
        goodsCents: goods,
        shippingCents: shipping,
        dutyCents: duty,
        taxCents: tax,
        allInCents: allIn,
        displayedPriceCents: displayed,
    };
}
