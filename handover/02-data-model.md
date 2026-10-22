# 02 · 数据模型（实体与字段）

> 权威源码见 `types/frontend-contract.ts`。这里是逐字段说明 + 是否必填 + 前端用途。
> 类型标记：`?` = 可选。金额一律 `number`（前端用 `money()` 格式化成 `$`）。

## Product（商品，目录/卡片用）
| 字段 | 类型 | 必填 | 说明 / 前端用途 |
|---|---|---|---|
| `id` | string | ✅ | 商品唯一 ID（URL `/product/:id`、购物车关联、图片种子） |
| `name` | string | ✅ | 标题（卡片单行截断显示） |
| `brand` | string | ✅* | 品牌。**站点无品牌、UI 不显示**，但字段保留（后端多半有）。可传空串 |
| `category` | string | ✅ | 所属分类 slug（对应 `Category.slug`） |
| `sub` | string | ✅ | 子分类名（对应 `Category.subs` 里的一项） |
| `price` | number | ✅ | 展示/起售价。**若该商品有 SKU 矩阵，实际以 SKU 价为准**（见 Sku.price） |
| `compareAt` | number? | ❌ | 划线原价（有则显示折扣 `-X%`）。区间商品不显示 |
| `priceRange` | [number, number]? | ❌ | **价格区间 [最低, 最高]**。当 SKU 价格不一致时提供；卡片显示 `$min – $max`（例：f2 = [3,121]）。给了它就不再显示单一 compareAt/折扣 |
| `rating` | number | ✅ | 0–5 平均分 |
| `reviews` | number | ✅ | 评价条数（卡片/详情显示，如 5000） |
| `glyph` | string | ✅ | emoji 占位图（图片全失败时的最后兜底） |
| `badge` | `'new' \| 'sale' \| 'best' \| ''` | ✅ | 角标：NEW/SALE/BEST SELLER/无 |
| `stock` | number | ✅ | 商品级库存（无变体时用；有变体时以 SKU.stock 为准） |
| `blurb` | string | ✅ | 一句话卖点（搜索命中 + 部分展示） |

## Category（分类）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `slug` | string | ✅ | 分类 slug（URL `/category/:slug`） |
| `name` | string | ✅ | 显示名 |
| `icon` | string | ✅ | emoji 图标（Mega Menu / 分类页标题） |
| `blurb` | string | ✅ | 描述 |
| `subs` | string[] | ✅ | 子分类名列表（Mega Menu 圆形磁贴 + 分类页侧栏筛选）。当前每类 6 个 |

## Sku / SKU 矩阵（详情页选款，核心）
一个商品的**可购变体 = 若干正交轴（如 Colour、Size）的笛卡尔积**，每个组合是一个 SKU，**自带图/码/价/库存**。
```
SkuModel { axes: SkuAxis[]; skus: Sku[]; groupAxis: SkuAxis | null }
SkuAxis  { name: string; type: 'color' | 'size' | 'other'; options: Swatch[] }
Swatch   { value: string; image?: string }   // 颜色轴的 option 带小图
Sku      { key: string; combo: Record<string,string>; code: string; image: string; price?: number; stock: number }
```
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `axes[].name` | string | ✅ | 轴名（"Colour" / "Size (EU)" / "Size" …） |
| `axes[].type` | enum | ✅ | `color`（渲染成图片色块）/ `size`（芯片）/ `other` |
| `axes[].options[].value` | string | ✅ | 选项值（"粉色 Pink"、"42" …） |
| `axes[].options[].image` | string? | ❌ | 该颜色的小图 URL（颜色轴用） |
| `skus[].key` | string | ✅ | 组合唯一键（例 `"粉色 Pink\|10 mm · 10 pcs"`），购物车用它区分 |
| `skus[].combo` | object | ✅ | 各轴取值，如 `{ "Colour": "粉色 Pink", "Size": "10 mm · 10 pcs" }` |
| `skus[].code` | string | ✅ | SKU 编码（详情页显示，如 TB1-011） |
| `skus[].image` | string | ✅ | **该组合的主图**（不同尺码/颜色可有不同照片） |
| `skus[].price` | number? | ❌ | 该 SKU 单价（支持**每变体不同价**，如不同尺寸不同价）。缺省时用 Product.price |
| `skus[].stock` | number | ✅ | 该 SKU 库存（0 = 该组合售罄，置灰） |
| `groupAxis` | SkuAxis\|null | ✅ | 缩略图分组轴（一般是颜色） |

> **规模提示**：真实商品可能很大（tb1 = 23 色 × 6 规格 = 138 SKU；示例 f2 = 100 色 × 10 码 = 1000 SKU）。后端返回时建议**一次返回该商品全部 SKU**（前端详情页需要），或提供分页（见 `07`）。

## Detail（详情页富数据）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `desc` | string | ✅ | 简述 |
| `paragraphs` | string[]? | ❌ | 长描述多段 |
| `highlights` | string[] | ✅ | 卖点列表 |
| `specs` | [string,string][] | ✅ | 规格表（键值对数组） |
| `variants` | {name, options[]}[] | ✅ | 变体轴（与 SkuModel.axes 一致，用于详情标签页展示） |
| `reviews` | Review[] | ✅ | 评价列表 `{ who, stars, title, text, when, verified }` |
| `breakdown` | [number,number][] | ✅ | 评分分布 `[[星级, 条数], …]`（5★→1★） |
| `bundle` | Product[] | ✅ | 搭配/相关商品（用于 Frequently bought together） |
| `eta` | string | ✅ | 送达时效文案 |
| `auto` | AutoDetail? | ❌ | **仅汽配类**：`{ oe, alt[], quality:'OE'\|'OEM'\|'AF', fits[], moq, weight, pkg }`（OE 号/交叉参考/车型适配/MOQ） |

## CartItem（购物车行，前端 localStorage 结构）
| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 行唯一键：有变体 = `${productId}::${skuKey}`，无变体 = `productId` |
| `id` | string | 商品 ID |
| `name` | string | 商品名 |
| `variant` | string? | 变体文字（如 "粉色 Pink · 10 mm · 10 pcs"） |
| `skuCode` | string? | SKU 编码 |
| `image` | string? | 该 SKU 图 |
| `price` | number | 该行单价（= SKU 价或商品价） |
| `qty` | number | 数量 |

## Order（下单，前端目前假造，需后端定义）
建议至少：`{ items: [{ productId, skuKey, qty, unitPrice }], shipping: {name,addr,city,zip,country}, totals: { subtotal, shipping, tax, total }, currency, status }`。订单号前缀 `OS-`。
