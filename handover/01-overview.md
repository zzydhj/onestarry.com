# 01 · 项目总览

## 是什么
「Onestarry」综合电商前端（原 BNK Market），Nuxt 3 单页应用。当前是**可运行的 UI 原型**，所有数据来自本地静态模块，用于确定**业务模式与交互**，等待接入真实后端。

## 技术栈
- 框架：**Nuxt 3**（3.21.x）+ Vue 3 + TypeScript + Vite
- 样式：**@nuxtjs/tailwindcss**（Tailwind v3）
- 设计令牌：主色 `#FFC400` / 墨 `#111318` / 画布 `#F4F5F7`；字体 Barlow Condensed（标题）+ Inter（正文）；容器最大宽 1440px
- 计划中的后端形态：Nuxt + Neon Postgres + Cloudflare Workers（仅规划，未接）

## 目录结构（与数据相关的部分）
```
data/            # 当前所有 mock 数据（要替换成后端接口的地方）
  categories.ts       分类树（8 大类，每类 6 个子类）
  products.ts         商品目录（Product[]，由元组 rows 构建）
  productDetails.ts   详情页富数据（buildDetail：描述/规格/变体/评价/搭配/ETA，汽车类含 OE/适配）
  skus.ts             SKU 矩阵（getSkuModel：每个 颜色×尺码 组合的 图/码/价/库存）
  imported.ts         一个真实导入商品（tb1）：23 色真实图 × 6 规格真实价
utils/
  productImage.ts     商品图/画廊/子类目缩略图的取图策略（Unsplash 池 + Picsum 兜底 + 真实直链）
  format.ts           money()（$ USD）、discountPct()、badge 文案等
composables/
  useCart.ts          购物车（localStorage，按 SKU 分行）
  useSku.ts           详情页 SKU 选择 + 多 SKU 暂存选款(draft)共享状态
  useCatalog.ts       搜索/筛选/排序（当前前端全量过滤）
  useHeaderMenu.ts / useToast.ts
config/sku.ts         SKU 相关阈值（是否启用多 SKU 暂存等）
components/           AppHeader / MegaMenu / ProductCard / ProductImage / product/* 等
pages/                index / category/[slug] / product/[id] / search / cart / checkout / account / brands / deals / help / login / register / terms
```

## 现状：哪些是 mock、哪些要接后端
| 能力 | 现状 | 需要后端提供 |
|---|---|---|
| 商品目录 / 详情 / SKU | 静态 `data/*.ts` | ✅ 商品/变体/详情读接口 |
| 分类树 | 静态 `categories.ts` | ✅ 分类读接口 |
| 搜索 / 筛选 / 排序 | 前端 `useCatalog` 全量过滤 | ✅ 服务端搜索/分页（数据量大时） |
| 购物车 | 前端 localStorage（已按 SKU 分行） | ⚠️ 可选：后端购物车（看 `07` 决策） |
| 下单 / 结账 | **假的**（随机订单号 + 清空） | ✅ 下单写接口 + 运费/税计算 |
| 登录 / 注册 / 账户 | demo 占位 | ✅ 鉴权 + 用户/订单接口 |
| 评价 / 评分分布 | 静态生成 | ✅ 评价读接口（或写：提交评价） |
| 收藏 / 询价 / 联系客服 | toast 占位 | ⚠️ 可选写接口 |
| 图片 | Unsplash/Picsum/真实直链混合 | ✅ 换成后端自己的 CDN/对象存储 URL |

## 重要约定
- **币种**：全站显示 `$`（USD）。`money(n) = '$' + n.toLocaleString('en-US',{min/max 2 位})`。导入的真实商品原价是人民币，但 UI 一律按 `$` 展示——**接后端时需明确价格币种与是否多币种**（见 `07`）。
- **无品牌**：站点定位无品牌，商品卡/列表已不展示 brand（后端仍可能有 brand 字段，前端不显示即可）。
- **数据访问尚未收口**：目前 `pages/product/[id].vue` 等**直接 import** `data/products.ts`，只有一个薄抽象 `useCatalog`。接后端前要先做「数据层收口」（见 `06`）。
