# 05 · 字段映射表（后端填写）

把你们后端**实际的字段名 / 接口路径**填进「你的字段」列，并勾选是否支持。
填完这份表，前后端就"对上了"，前端即可按 `06` 改造数据层。

图例：✅ 直接支持 / 🔶 需转换（单位、拼接、枚举映射）/ ❌ 不支持（需后端补或前端降级）

## Product
| 前端字段 | 类型 | 必填 | 你的字段/来源 | 状态 | 备注 |
|---|---|---|---|---|---|
| id | string | ✅ | | | |
| name | string | ✅ | | | |
| brand | string | ✅ | | | 无品牌可填 "" |
| category | string | ✅ | | | 需与 Category.slug 对应 |
| sub | string | ✅ | | | 需与 Category.subs 对应 |
| price | number | ✅ | | | 币种？见 07 |
| compareAt | number? | ❌ | | | 划线原价 |
| priceRange | [min,max]? | ❌ | | | 各 SKU 价不一致时 |
| rating | number | ✅ | | | 0–5 |
| reviews | number | ✅ | | | 条数 |
| glyph | string | ✅ | | | emoji 兜底，可固定 "🛍️" |
| badge | enum | ✅ | | | new/sale/best/"" 如何映射？ |
| stock | number | ✅ | | | 无变体时 |
| blurb | string | ✅ | | | |

## SkuModel（变体矩阵）
| 前端字段 | 类型 | 必填 | 你的字段/来源 | 状态 | 备注 |
|---|---|---|---|---|---|
| axes[].name | string | ✅ | | | 变体属性名 |
| axes[].type | color/size/other | ✅ | | | 你们如何区分"颜色/尺码"？ |
| axes[].options[].value | string | ✅ | | | |
| axes[].options[].image | string? | ❌ | | | 颜色小图 |
| skus[].key | string | ✅ | | | 稳定唯一组合键 |
| skus[].combo | object | ✅ | | | 各轴取值 |
| skus[].code | string | ✅ | | | SKU 编码 |
| skus[].image | string | ✅ | | | 组合主图 |
| skus[].price | number? | ❌ | | | **每变体不同价是否支持？** |
| skus[].stock | number | ✅ | | | **每变体独立库存？** |

## Detail
| 前端字段 | 类型 | 必填 | 你的字段/来源 | 状态 | 备注 |
|---|---|---|---|---|---|
| desc | string | ✅ | | | |
| paragraphs | string[]? | ❌ | | | 长描述 |
| highlights | string[] | ✅ | | | |
| specs | [k,v][] | ✅ | | | 规格键值对 |
| variants | {name,options[]}[] | ✅ | | | 与 axes 一致 |
| reviews | Review[] | ✅ | | | {who,stars,title,text,when,verified} |
| breakdown | [star,count][] | ✅ | | | 评分分布 |
| bundle | Product[] | ✅ | | | 搭配/相关 |
| eta | string | ✅ | | | 时效 |
| auto | AutoDetail? | ❌ | | | 汽配专属，可忽略 |

## Category
| 前端字段 | 类型 | 必填 | 你的字段/来源 | 状态 | 备注 |
|---|---|---|---|---|---|
| slug | string | ✅ | | | |
| name | string | ✅ | | | |
| icon | string | ✅ | | | emoji，可后端给或前端固定 |
| blurb | string | ✅ | | | |
| subs | string[] | ✅ | | | 二级分类 |

## CartItem（若走后端购物车）
| 前端字段 | 类型 | 你的字段/来源 | 状态 | 备注 |
|---|---|---|---|---|
| key | string | | | productId::skuKey |
| id / skuKey | string | | | |
| variant | string? | | | 变体文字（可由 combo 拼接） |
| price | number | | | 单价 |
| qty | number | | | |

## Order（下单）
| 前端字段 | 类型 | 你的字段/来源 | 状态 | 备注 |
|---|---|---|---|---|
| items[].productId | string | | | |
| items[].skuKey | string | | | **下单能否带具体变体？** |
| items[].qty | number | | | |
| shipping | object | | | 地址字段以你方为准 |
| totals.subtotal/shipping/tax/total | number | | | 由后端计算返回 |
| currency | string | | | |
| orderNo | string | | | |

## 关键能力勾选（后端逐项确认）
- [ ] 每个变体组合可独立**定价**
- [ ] 每个变体组合可独立**图片**
- [ ] 每个变体组合可独立**库存**（含"该组合售罄"）
- [ ] 下单可提交**具体 SKU**（非只 productId）
- [ ] 服务端**搜索/筛选/分页**
- [ ] 服务端计算**运费/税/总额**
- [ ] 图片为**可公网访问 URL**（或签名 URL）
- [ ] 币种与小数位规则：__________
