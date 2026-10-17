/**
 * core/sellability.ts —— 可售性单一函数（§3.2 核心规范 / §15 步骤 7）
 *
 * 纯函数、零依赖、不碰 DB：调用方（搜索文档、PDP、结账校验、Merchant feed 四处）
 * 先把事实拼好传入，杜绝"搜索可见但结账死胡同"的断裂。
 *
 * 六条判定（任一不过即不可售，返回全部原因码）：
 *  1) 商品状态 active
 *  2) 市场启用
 *  3) 商品级/变体级 可售市场白/黑名单（product_market_availability）
 *  4) 品类在该市场被禁售（market_compliance_profiles.prohibited_categories）
 *  5) 该市场有价格（variant_market_prices）
 *  6) 运费区覆盖目的国（shipping_zones）
 *  7) 库存可售（按 availability_policy）
 */

export type ProductStatus = "draft" | "active" | "archived";
export type AvailabilityPolicy = "in_stock_only" | "backorder" | "preorder" | "made_to_order";

/** 该市场对"这个商品/变体"的白/黑名单事实（由查询层预聚合）。 */
export interface AvailabilityFacts {
    /** 该市场是否配置了 allow 白名单（有则进入白名单模式，未命中即不可售）。 */
    hasAllowlist: boolean;
    /** 该商品/变体是否命中白名单。 */
    allowed: boolean;
    /** 该商品/变体是否命中黑名单（命中直接不可售，优先级最高）。 */
    denied: boolean;
}

export interface SellabilityInput {
    productStatus: ProductStatus;
    marketActive: boolean;
    availability: AvailabilityFacts;
    prohibited: boolean;
    hasPrice: boolean;
    shipsTo: boolean;
    availabilityPolicy: AvailabilityPolicy;
    /** 可售库存（on_hand - reserved，由库存层给出）。 */
    availableQty: number;
}

export type SellableReason =
    | "product_not_active"
    | "market_inactive"
    | "availability_denied"
    | "not_in_allowlist"
    | "category_prohibited"
    | "no_price"
    | "no_shipping"
    | "out_of_stock";

export interface SellabilityResult {
    sellable: boolean;
    /** 全部不通过原因（可售时为空数组）。 */
    reasons: SellableReason[];
}

/** 单一入口：判断某商品/变体在某市场是否可售。 */
export function computeSellability(input: SellabilityInput): SellabilityResult {
    const reasons: SellableReason[] = [];

    if (input.productStatus !== "active") reasons.push("product_not_active");
    if (!input.marketActive) reasons.push("market_inactive");

    // 黑名单优先；白名单模式下未命中即不可售。
    if (input.availability.denied) reasons.push("availability_denied");
    else if (input.availability.hasAllowlist && !input.availability.allowed) reasons.push("not_in_allowlist");

    if (input.prohibited) reasons.push("category_prohibited");
    if (!input.hasPrice) reasons.push("no_price");
    if (!input.shipsTo) reasons.push("no_shipping");

    // 仅 in_stock_only 因缺货判不可售；backorder/preorder/made_to_order 允许 0 库存下单。
    if (input.availabilityPolicy === "in_stock_only" && input.availableQty <= 0) reasons.push("out_of_stock");

    return { sellable: reasons.length === 0, reasons };
}
