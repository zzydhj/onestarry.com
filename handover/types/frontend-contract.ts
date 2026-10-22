/**
 * Onestarry 前端数据契约（权威类型定义）
 * ------------------------------------------------
 * 这是前端 UI 实际消费的所有数据结构。后端接口的响应只要能映射到这些形状，
 * 前端页面/组件即可不改而直接对接（差异在 service 层做 DTO 转换）。
 * 字段与 data/*.ts、composables/*.ts 的真实实现一致。
 */

// ---------- 分类 ----------
export interface Category {
    slug: string
    name: string
    icon: string // emoji
    blurb: string
    subs: string[] // 二级分类名（Mega Menu / 侧栏筛选）
}

// ---------- 商品（目录 / 卡片） ----------
export type Badge = 'new' | 'sale' | 'best' | ''

export interface Product {
    id: string
    name: string
    brand: string // 无品牌站：可传 ""，UI 不展示
    category: string // Category.slug
    sub: string // Category.subs 之一
    price: number // 展示/起售价；有 SKU 矩阵时以 Sku.price 为准
    compareAt?: number // 划线原价（有则显示 -X%）
    priceRange?: [number, number] // SKU 价不一致时 → 卡片显示 "$min – $max"
    rating: number // 0–5
    reviews: number // 评价条数
    glyph: string // emoji 兜底图
    badge: Badge
    stock: number // 无变体时的库存
    blurb: string
}

// ---------- SKU 矩阵（详情页选款） ----------
export type AxisType = 'color' | 'size' | 'other'

export interface Swatch {
    value: string
    image?: string // 颜色轴选项的小图
}

export interface SkuAxis {
    name: string // "Colour" | "Size (EU)" | ...
    type: AxisType
    options: Swatch[]
}

export interface Sku {
    key: string // 组合唯一键，如 "粉色 Pink|10 mm · 10 pcs"
    combo: Record<string, string> // { Colour: "...", Size: "..." }
    code: string // SKU 编码，如 "TB1-011"
    image: string // 该组合主图
    price?: number // 该 SKU 单价（支持每变体不同价）；缺省用 Product.price
    stock: number // 该 SKU 库存（0=售罄）
}

export interface SkuModel {
    axes: SkuAxis[]
    skus: Sku[]
    groupAxis: SkuAxis | null // 缩略图分组轴（一般颜色）
}

// ---------- 详情富数据 ----------
export interface Variant {
    name: string
    options: string[]
}

export interface Review {
    who: string
    stars: number
    title: string
    text: string
    when: string
    verified: boolean
}

export interface Fit {
    mk: string // make
    md: string // model
    y: string // years
    en: string[] // engines
}

export interface AutoDetail {
    oe: string // OEM 零件号
    alt: string[] // 交叉参考
    quality: 'OE' | 'OEM' | 'AF'
    fits: Fit[] // 车型适配
    moq: number // 起订量
    weight: string
    pkg: string // 包装
}

export interface Detail {
    desc: string
    paragraphs?: string[]
    highlights: string[]
    specs: [string, string][] // [label, value]
    variants: Variant[]
    reviews: Review[]
    breakdown: [number, number][] // [星级, 条数]，5★→1★
    bundle: Product[] // 搭配/相关
    eta: string
    auto?: AutoDetail // 仅汽配
}

// ---------- 购物车行（前端 localStorage 结构；后端购物车需等价） ----------
export interface CartItem {
    key: string // productId::skuKey（无变体则 = productId）
    id: string // productId
    name: string
    variant?: string // "粉色 Pink · 10 mm · 10 pcs"
    skuCode?: string
    image?: string // SKU 图
    price: number // 单价
    glyph: string
    qty: number
}

// ---------- 下单（建议契约，最终以后端为准） ----------
export interface OrderLine {
    productId: string
    skuKey?: string
    qty: number
    unitPrice: number
}
export interface ShippingAddress {
    name: string
    addr: string
    city: string
    zip: string
    country: string
}
export interface OrderTotals {
    subtotal: number
    shipping: number
    tax: number
    total: number
}
export interface Order {
    orderNo: string // "OS-xxxxxx"
    items: OrderLine[]
    shipping: ShippingAddress
    totals: OrderTotals
    currency: string // "USD"
    status: string
}

// ---------- 列表查询参数 ----------
export interface ProductQuery {
    category?: string
    sub?: string
    q?: string
    sort?: 'featured' | 'price-asc' | 'price-desc' | 'rating' | 'reviews'
    page?: number
    limit?: number
}
export interface Paged<T> {
    items: T[]
    total: number
    page: number
    limit: number
}
