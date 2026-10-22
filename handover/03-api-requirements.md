# 03 · API 需求（前端需要后端提供的能力）

> 端点路径/风格由后端定，前端会适配。这里描述**每个页面/组件需要什么数据、什么操作**。
> 建议 REST + JSON；分页统一用 `?page=&limit=`，响应带 `total`。所有响应字段名以 `02-data-model.md` 为准。

## 读接口

### 1. 分类树
`GET /categories` → `Category[]`
消费方：Mega Menu、首页分类区、分类页侧栏、面包屑。

### 2. 商品列表（分类 / 搜索 / 排序 / 分页 共用）
`GET /products?category=&sub=&q=&sort=&page=&limit=`
→ `{ items: Product[], total: number, page: number, limit: number }`
- `category`：分类 slug；`sub`：子分类名；`q`：关键词；
- `sort` ∈ `featured | price-asc | price-desc | rating | reviews`；
- 消费方：首页 Trending/Best/New/On sale 标签、分类页、搜索结果页、Deals 页。
- ⚠️ 目前前端是**一次性拉全量再本地过滤**；数据量大时请后端支持服务端过滤+分页（见 `07`）。

### 3. 单个商品
`GET /products/:id` → `Product`
消费方：详情页头部、购物车行回链。

### 4. 商品 SKU 矩阵（详情页选款，必需）
`GET /products/:id/skus` → `SkuModel`
消费方：SkuPicker（颜色/尺码）、ProductBuyBox（价格随 SKU 变）、多 SKU 暂存选款、按 SKU 分行加购。
**关键要求**：每个 SKU 必须带 `key / combo / code / image / price? / stock`。

### 5. 商品详情富数据
`GET /products/:id/detail` → `Detail`
消费方：详情页 Description/Specifications/Reviews/搭配/ETA（汽配类还有 Fitment/Cross-reference）。
（也可与 #3/#4 合并成一个 `GET /products/:id`（含 skus+detail），后端决定。）

### 6. 相关/搭配商品
`GET /products/:id/related` → `Product[]`
（或由 detail.bundle 提供。）消费方：详情页 Related products、Frequently bought together。

## 写接口

### 7. 购物车
两种方案（见 `07` 决策）：
- **A 纯前端购物车**（现状，localStorage）：后端只需在**下单**时接收行项目。→ 无需购物车接口。
- **B 后端购物车**：
  - `GET /cart` → `CartItem[]`
  - `POST /cart/items` body `{ productId, skuKey, qty }` → 更新后的 cart
  - `PATCH /cart/items` body `{ key, qty }`（改数量，qty=0 删除）
  - `DELETE /cart/items/:key`

### 8. 下单 / 结账（必需）
`POST /orders`
```
body: {
  items: [{ productId, skuKey, qty }],
  shipping: { name, addr, city, zip, country },
  // 支付由后端/第三方支付处理，前端不传卡号明文
}
→ { orderNo: "OS-xxxxxx", totals: { subtotal, shipping, tax, total }, status, currency }
```
- 运费/税/总额**应由后端计算返回**（前端现在是写死的免邮 $75、8% 税，仅演示）。
- 消费方：`pages/checkout.vue`（现为假下单）。

### 9. 鉴权 / 账户
- `POST /auth/login`、`POST /auth/register`、`GET /me`
- `GET /me/orders` → 订单列表；`GET /me/addresses` 等。
- 消费方：login/register/account 页（现全为 demo）。

### 10. 评价（可选写）
- `GET /products/:id/reviews?page=`（若评价量大需分页，替代 detail.reviews）
- `POST /products/:id/reviews`（提交评价，可选）

## 非功能要求
- **CORS**：允许前端域名（含本地 dev `http://localhost:3000`）。
- **鉴权方式**：cookie 还是 Bearer token？（影响前端 `$fetch` 配置，见 `07`）。
- **图片 URL**：可公网访问；若是私有对象存储需给**签名 URL**或公开 CDN。
- **错误格式**：统一 `{ error: { code, message } }` 便于前端 toast。
- **环境变量**：前端会用 `runtimeConfig.public.apiBase` 注入后端地址。
