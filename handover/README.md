# Onestarry 前端 → 后端对接交接包 (Handover)

把这套 Nuxt 3 前端接到一个**已建好后端**的电商站上时，所需的全部资料都在这个文件夹里。
目标：让后端团队照着「数据契约 + 字段清单 + API 需求」来对齐/适配，前端只需把数据来源从本地 mock 换成他们的接口。

## 阅读顺序

| 文件 | 内容 | 给谁看 |
|---|---|---|
| `01-overview.md` | 项目/技术栈/现状（哪些是 mock、哪些要接后端） | 全体 |
| `02-data-model.md` | 所有实体的字段定义（Product / Sku / Detail / Category / CartItem / Order） | 后端 + 前端 |
| `03-api-requirements.md` | 前端需要后端提供的能力与请求/响应结构 | 后端 |
| `04-business-rules.md` | 关键业务规则（SKU 矩阵、价格区间、按 SKU 分行购物车、多 SKU 暂存选款、币种、图片、搜索分页） | 后端（重点） |
| `05-field-mapping-template.md` | 字段映射表模板：后端把他们的字段填进来对齐 | 后端填写 |
| `06-integration-checklist.md` | 前端接入步骤清单（把 mock 换成真实 API 的改造点） | 前端 |
| `07-open-questions.md` | 开工前需要双方确认的决策点 | 全体 |
| `types/frontend-contract.ts` | 前端类型契约的**权威源码**（TS interface，可直接拷给对方或生成 JSON Schema） | 后端 |
| `examples/product.example.json` | 商品示例：单一价 / 区间价(priceRange) / 无品牌 | 后端 |
| `examples/sku-model.example.json` | SKU 矩阵示例：正交轴 + 每组合独立价/图/库存 | 后端 |
| `examples/cart.example.json` | 购物车示例：按 SKU 分行的 CartItem[] + 合计 | 后端 |
| `examples/order.example.json` | 下单示例：请求/响应契约（建议，最终以后端为准） | 后端 |
| `frontend-src/` | **前端源码副本**（干净 Nuxt 工程，含 `data/` mock 作数据形状示例） | 前端+后端 |

## 前端源码（`frontend-src/`）

一份**可直接运行的 Nuxt 3 工程副本**（已排除 `node_modules/`、`.nuxt/`、临时截图、旧静态参考稿）。对方 `npm install && npm run dev` 即可跑起来看真实交互。

目录（均为 Nuxt 运行所需）：`app.vue` `error.vue` `nuxt.config.ts` `package.json` `tailwind.config.ts` `tsconfig.json` + `components/`（含 `product/`）、`composables/`、`pages/`、`layouts/`、`plugins/`、`utils/`、`config/`、`data/`、`assets/`、`public/`。

**接后端时要改的入口（其余页面/组件尽量不动）：**
| 现状（mock 来源） | 接后端后 |
|---|---|
| `data/products.ts` `categories.ts` `productDetails.ts` `skus.ts` `imported.ts` | 由 service 层 `$fetch` 取代，保留 `data/` 仅作字段形状参考 |
| `composables/useCatalog.ts`（唯一的薄封装，但页面也有直接 import） | 收口成真正的取数层：`getProducts/getProduct/getSkuModel/getDetail/getCategories` |
| `composables/useCart.ts` + `plugins/cart.client.ts`（localStorage） | 换成服务端购物车接口（按 SKU 分行，见 `04`） |
| `pages/checkout.vue`（假结账） | 接 `POST /orders`（见 `examples/order.example.json`） |
| `utils/productImage.ts`（Unsplash/picsum 兼底） | 换成你们 CDN 图 URL（Sku.image / Product 图） |

> 详见 `06-integration-checklist.md` 的逐步改造清单。

## 一句话结论
前端目前是**纯静态 demo**（数据来自 `data/*.ts`，购物车在 localStorage，结算是假的），**还没有 API 层**。
要打通，核心是：① 后端按 `02/03/04` 提供数据与写接口；② 前端按 `06` 把数据层换成 `$fetch`。
其中**最容易对不上的是 SKU 变体模型和价格模型**（见 `04-business-rules.md` 第 1、2 条），请后端优先确认。
