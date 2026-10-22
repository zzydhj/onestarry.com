# 06 · 前端接入清单（把 mock 换成真实 API）

> 前提：已拿到后端的 API 文档/示例 + 填好的 `05-field-mapping-template.md`。
> 目标：页面/组件**尽量不动**，只把"数据从哪来"从本地模块换成 `$fetch`。

## 第 0 步：数据层收口（当前最大的技术债）
现在数据是**散点直接 import** 的，必须先收口到一层，否则要改很多地方。
- 现状：`pages/product/[id].vue`、`pages/index.vue`、`components/CartDrawer.vue` 等**直接** `import { productById, productsByCategory } from '~/data/products'`；只有 `composables/useCatalog.ts` 是个薄封装。
- 做：新建 `api/` 或 `services/` 目录，把所有"取数"集中到函数（`getProducts(params)`、`getProduct(id)`、`getSkuModel(id)`、`getDetail(id)`、`getCategories()`…），页面只调这些函数。
- 先让这些函数**内部仍返回本地 mock**（保证不回归），下一步再换成 `$fetch`。

## 第 1 步：环境变量与客户端
- `nuxt.config.ts` 加：
  ```ts
  runtimeConfig: { public: { apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:8000' } }
  ```
- 建一个 `$fetch` 实例（`api/http.ts`）：`const { public: { apiBase } = useRuntimeConfig(); export const api = $fetch.create({ baseURL: apiBase, ... })`，统一处理鉴权头、错误。

## 第 2 步：读接口替换（异步化）
把第 0 步的取数函数逐个换成真实请求，并把调用点从"同步值"改成"异步"：
- `getCategories()` → `api('/categories')`
- `getProducts({category,sub,q,sort,page,limit})` → `api('/products', { query })`（**注意：现在前端本地过滤/排序，换成后端后要删掉 `useCatalog` 里的本地 filter/sort，改用后端返回**）
- `getProduct(id)` / `getSkuModel(id)` / `getDetail(id)` → 对应接口
- 页面用 `useAsyncData` / `useFetch` 包一层（SSR + 缓存），例如：
  ```ts
  const { data: product } = await useAsyncData(`product-${id}`, () => getProduct(id))
  ```
- **DTO 适配**：后端字段名/结构与 `02` 不一致时，在 service 层写一个 `mapProduct(raw): Product` 做转换（保持组件不变）。

## 第 3 步：图片
- 把 `utils/productImage.ts` 的"池子/兜底"逻辑替换成**直接读后端返回的 URL**：
  - `Product` 应带主图 URL（建议后端加 `image` 字段，或 `images[]`）
  - `Sku.image` / `Swatch.image` 用后端值
  - 子类目缩略图：后端给（或前端保留占位）
- 保留 `ProductImage.vue` 的三级降级（真实图 → 兜底 → emoji）即可，只是 primary 用后端 URL。

## 第 4 步：购物车（二选一，见 07）
- **方案 A 保留前端购物车**：`useCart` 不动，只确保 `add(product, qty, sku)` 里的 `sku` 来自后端 SkuModel；下单时把 `stagedLines`/cart 行映射成 `POST /orders` 的 items（带 skuKey）。
- **方案 B 后端购物车**：把 `useCart` 的 add/setQty/remove 改成调用 `POST/PATCH/DELETE /cart`，`items` 用 `useAsyncData` 拉 `GET /cart`；localStorage 那套可去掉。

## 第 5 步：下单 / 结账
- `pages/checkout.vue` 的 `placeOrder()`：从"假订单号"改成 `POST /orders`，用后端返回的 `totals`（运费/税/总额）替换前端写死的免邮/税率。
- 支付：按后端/第三方支付（Stripe/PayPal 等）的对接方式接（前端不碰明文卡号）。

## 第 6 步：鉴权 / 账户
- login/register 接 `POST /auth/*`；token/cookie 存法与 `api` 实例的鉴权头一致。
- account 页 `GET /me/orders` 等替换静态数据。

## 第 7 步：搜索/分页/边界
- 分类页、搜索页接后端分页（页码或无限滚动）；`total` 驱动。
- 处理：加载态、空态、错误态（后端错误 → toast）、SSR 首屏。

## 验收清单
- [ ] 首页/分类/搜索/详情/购物车/结账 全部走真实接口，无本地 mock import
- [ ] 变体选款、价格随 SKU 变、按 SKU 分行加购、多 SKU 暂存选款 均正常
- [ ] 价格区间商品显示 `$min – $max`
- [ ] 下单成功、订单号/金额来自后端
- [ ] 图片来自后端 CDN、无裂图（降级链正常）
- [ ] 鉴权/账户可用（若纳入范围）
- [ ] Lighthouse/SSR 无 hydration 严重报错（现有购物车角标 hydration 警告见 07 附注）
