# onestarry 全球电商模板 · 实现地图（IMPLEMENTATION.md）

> **分工**：`全球电商模板-架构方案-交叉验证版.md`（下称"架构文档"）= 设计蓝图，讲 **为什么/做什么/施工顺序**；本文件 = **代码真相**，讲 **在哪/做到什么程度/与蓝图差多少**。
> **本文件所有条目均来自对仓库的实际扫描**（文件枚举 + 导出符号提取 + 跨文件引用检索 + 关键文件通读），不来自记忆或架构文档的转述。
> 基线 commit：`2339256`（tag `template-v1.0`）· 扫描日期：2026-10-21
>
> **图例**
> ✅ 已实现且已验证（连库冒烟 / build / 本地 dev / 线上抽查之一以上）
> 🟡 已实现，但未做端到端验证（代码在、逻辑通，缺一次真实跑）
> ⏸️ 只留接口/插槽，等外部账户或密钥
> ⛔ **有表无逻辑**（schema + 迁移已建，业务代码零引用）
> ❌ 架构文档写了，代码里**不存在**（属未开工或已被替代）

---

## 0. 一分钟结论

**已经真跑通的主干**（可当模板直接复用）：
站级单一真源 → Neon/Hyperdrive/Drizzle/UUIDv7 → 目录（类目/品牌/属性/slug/媒体/译文）→ 库存 → 全包价物化管道（outbox+cron relay+写时自派发）→ 前台 ISR 浏览/搜索/PDP/JSON-LD/seo_meta/sitemap/robots/同意横幅/法律页 → 购物车→下单→假 PSP 回调→**两段式账本+连号发票**→后台标记发货（收入/COGS/扣库存/sale 流水）→ CMS → 评论 → 集成 API → 数据保留 job → 三 Worker 部署 + DB 角色分离。

**六个"看着有、其实没通电"的关键点**（详见 §10 偏差登记表）：

| # | 事项 | 真相 |
|---|---|---|
| D01 | 税/关税/运费/汇率 | `taxRate:0 / dutyRate:0 / shippingCents:0 / fxRate:1` **硬编码占位**（`queries/pricing.ts` L152-159）→ 现在"全包价 = 基价原样" |
| D02 | `computeSellability` | 函数+单测都在，但**没有任何读取路径调用它**；`product_market_availability` 表零引用。可售性实际只看 `variant_market_prices.blocked` + `products.status` |
| D03 | 结账 | 运费**硬编码 500 分**、市场**硬编码 `us`**、`idempotencyKey = crypto.randomUUID()` 每次新建 → **幂等键不防重复提交**；无库存预留 |
| D04 | 权限点强制 | 8 个写动作文件里只有 **3 个**用了 `requirePermission`（content/markets/orders-import/reviews/team 共 6 文件）；**商品编辑 10 个动作、下单发货 `markShippedAction`、新建商品、类目/品牌/属性/法律页 = 只校验"已登录"**，违反架构文档铁律② |
| D05 | 底座配置表 | **12 张表有表无代码**（shippingZones/shippingRates/carriers/dutyRules/taxRatesConfig/taxRegistrations/deMinimisRules/marketComplianceProfiles/paymentProviderAccounts/locales/marketCountries/marketLocales + promotions/customerProfiles/consents 部分）→ §14"加国家=纯配置"目前**只在 markets 表列层面成立** |
| D06 | 步骤 13 邮件/退款/争议/PDF | `Resend`、`refunds`、`disputes`、`payouts`、发票 PDF → R2 **全部无实现**；退款权限点 `refund:write` 定义了但没有退款动作 |

**术语已过时**（架构文档正文仍这么写，代码已替代）：Inngest → **Workers Cron**；Typesense → **Postgres FTS**；Upstash Redis → **未使用**；Vitest → **node:test（tsx --test）**；GitHub Actions → **Cloudflare Workers Builds**；`packages/email`/`packages/authz`/`tools/scraper` → **不存在**。

---

## 1. 仓库布局实况

```
onestarry.com/
├── apps/
│   ├── web/        前台（Next 15 + OpenNext → Worker `onestarry-com`）  51 个 ts/tsx
│   ├── admin/      后台（Worker `onestarry-admin`）                      48 个 ts/tsx
│   └── jobs/       Cron Worker `onestarry-jobs`（纯 Worker，非 Next）     1 个 index.ts
├── packages/
│   ├── db/         schema(12) + queries(25) + seed(4) + smoke(11) + client/uuid7  ← 唯一写库出口
│   ├── core/       17 个纯 TS 模块（定价/运费/可售性/支付接缝/RBAC/CSV/哈希/site 常量）+ 6 个 test
│   ├── auth/       Better Auth 双实例工厂（index 39 行 + client 12 行）
│   ├── jobs/       outbox relay 引擎 + handler 注册表
│   ├── ui/         button/card/form/table/cn + styles.css（Tailwind v4）
│   ├── config/     eslint.config.mjs / tsconfig.base.json / tsconfig.next.json / tailwind.preset.ts
│   └── shared/     ⛔ **空壳**：只有 package.json（声明 ./src/i18n|money|pagination|constants 但 src 目录不存在），无任何代码引用
├── docs/           DR-RUNBOOK.md · REBRAND.md · IMPLEMENTATION.md（本文件）
├── README.md       技术栈/一键跑起来/Workers Builds 部署表/常见坑
├── 全球电商模板-架构方案-交叉验证版.md   （架构文档 v13）
└── .env.example + apps/{web,admin,jobs}/.dev.vars.example
```

与架构文档 §2 的差异：**没有** `packages/email`（邮件未开工）、`packages/authz`（RBAC 实际在 `core/rbac.ts` + `db/queries/authz.ts`）、`packages/db/repository`（repository 层即 `queries/`）、`tools/scraper`（URL 抓取在 `apps/admin/lib/importProviders.ts`，未独立成包）。`apps/jobs` 不是 Inngest 而是 Workers Cron。

---

## 2. 数据层

### 2.1 迁移链
| 迁移 | 内容 |
|---|---|
| `0000_volatile_legion` ~ `0014_melodic_human_torch`（15 个 drizzle-kit 生成） | 全量建表 + 逐段加列/索引；`content`/`contentTranslations` **在 0001 就已建**（CMS 因此零新迁移）；0006/0011/0012/0013/0014 为空/微调（生成噪声） |
| `drizzle/manual/0014_partition_append_only.sql` | `ledger_entries` + `stock_movements` 重建为 RANGE 月分区（幂等，经 `pnpm db:partition` 应用） |
| `drizzle/manual/0015_app_role.sql` | `app_rw` 角色 + 只追加表 REVOKE UPDATE/DELETE（**已在 Neon 执行、Hyperdrive 已切换**） |

> ⚠️ `0014_partition_append_only.sql` 与生成的 `0014_melodic_human_torch.sql` **同序号不同来源**，新库按 `drizzle/migrations` journal 走 `db:migrate` 后再单独跑 `db:partition`；重建模板站时顺序不可颠倒。

### 2.2 schema 模块 → 表（实际 75 张，含 Better Auth 8 张）
| 文件 | 表 |
|---|---|
| `schema/auth.ts` | **工厂生成两套**：`{customer,admin}_{user,session,account,verification}`（8 张，text id，符合 Better Auth 官方结构） |
| `schema/authz.ts` | roles, permissions, rolePermissions, principalRoles, customerProfiles |
| `schema/catalog.ts`（23） | brands, categories, attributeDefinitions, categoryAttributeSets, products, productOptions, optionValues, productVariants, mediaAssets, productImages, slugs, productTranslations, collections, collectionProducts, sizeCharts, wishlists, backInStockSubscriptions, productMarketAvailability, content, contentTranslations, seoMeta, reviews, urlRedirects |
| `schema/foundation.ts`（22） | legalEntities, paymentProviderAccounts, locales, markets, marketCountries, marketLocales, deMinimisRules, taxRegistrations, taxRatesConfig, dutyRules, marketComplianceProfiles, shippingZones, carriers, shippingRates, legalDocuments, consents, ledgerAccounts, ledgerTransactions, ledgerEntries★, invoiceSequences, invoices, creditNotes |
| `schema/inventory.ts` | inventory（`available` 为**生成列** = on_hand − reserved）, stockMovements★ |
| `schema/orders.ts` | addresses, idempotencyKeys, promotions, orders, orderItems, orderLines |
| `schema/outbox.ts` | transactionalOutbox（**非**只追加，relay 心跳要 UPDATE，切勿 REVOKE） |
| `schema/payments.ts` | payments, refunds, payouts, disputes, webhookEvents |
| `schema/pricing.ts` | variantMarketPrices, priceHistory |
| `schema/shipments.ts` | shipments |
★ = 已按月 RANGE 分区（manual/0014）

### 2.3 架构文档提到、但**表都没建**的
`inventory_locations` · `inventory_reservations` · `order_events` · `order_lookup` · `carts`/`cart_items`（改为 cookie 方案）· `returns`（RMA）· `audit_log` · `store_settings` · `daily_sales_stats` · `gift_cards`/`coupons` · `merchant_products`/`merchant_feed_statuses` · `terms_acceptances` · `seo_keywords`/`gsc_query_page`/`internal_links`/`search_console_metrics` · `review_votes`/`review_questions`/`review_moderation_queue` · `suppliers` · `e_invoice_targets`

### 2.4 ⛔ 有表无业务代码（占位表清单）
零引用：`shippingZones` `shippingRates` `carriers` `dutyRules` `taxRatesConfig` `taxRegistrations` `deMinimisRules` `marketComplianceProfiles` `paymentProviderAccounts` `locales` `marketCountries` `marketLocales` `productMarketAvailability` `urlRedirects` `wishlists` `backInStockSubscriptions` `sizeCharts` `collections` `collectionProducts` `promotions` `customerProfiles` `optionValues` `disputes` `refunds` `payouts` `creditNotes`
极低引用（1 文件，仅查询层自身）：`consents` `legalDocuments`（`queries/legal.ts`）`contentTranslations`（`queries/content.ts`）`seoMeta`（`queries/seo.ts`）

---

## 3. 模块实现地图

### 3.1 站级单一真源
| 项 | 位置 | 状态 |
|---|---|---|
| `SITE_ORIGIN` / `SITE_NAME` / `MEDIA_PUBLIC_BASE` | `packages/core/src/site.ts` | ✅ 被 sitemap/robots/layout/PDP JSON-LD/mediaUrl 引用；换皮只改这一个文件（`docs/REBRAND.md`） |

### 3.2 认证（Better Auth 双实例）
| 项 | 位置 | 状态 |
|---|---|---|
| 实例工厂 | `packages/auth/src/index.ts` → `createCustomerAuth` / `createAdminAuth`（每次请求按 `env.HYPERDRIVE.connectionString` 构造，Workers 无常驻） | ✅ |
| 路由 | `apps/web/app/api/auth/[...all]/route.ts`、`apps/admin/app/api/auth/[...all]/route.ts` | ✅ 前台开放注册、后台同（**后台注册可关闭性未做**：admin 实例未设 `emailAndPassword.disableSignUp`） |
| 客户端 | `packages/auth/src/client.ts` → `makeAuthClient`（后台登出用） | ✅ |
| 登录页 | 后台 `apps/admin/app/signin/page.tsx`（中文、无注册入口 UI）；前台 `apps/web/app/signin/page.tsx`（最简 demo，Sign up/Sign in/Sign out） | 🟡 前台页 UI 未设计化 |
| 2FA/Passkey/step-up/IP 告警 | — | ❌ 架构文档 §7 要求，未实现 |

### 3.3 授权 RBAC
| 项 | 位置 | 状态 |
|---|---|---|
| 权限点/角色单一真源 | `packages/core/src/rbac.ts`：`PERMISSIONS`(8 点) / `ROLES`(3) / `ROLE_PERMISSIONS`（staff = productWrite, orderWrite, categoryWrite, seoWrite）/ `roleHasPermission` | ✅ |
| seed 与查询 | `packages/db/src/queries/authz.ts`：`seedRbac` `getPrincipalPermissions` `getPrincipalRoles` `assignRole` `revokeRole` `listAdminMembers` | ✅ 连库验证过 |
| 守卫工具 | `apps/admin/lib/auth.ts`：`requireAdmin()`（会话+权限集）/ `requirePermission(perm)`（不足抛 `FORBIDDEN`） | ✅ |
| **覆盖矩阵** | 见 §4 | 🔴 **P0 缺口** |

### 3.4 目录（商品/类目/品牌/属性/媒体/slug/译文）
| 能力 | 位置 | 状态 |
|---|---|---|
| 浏览列表单一真源 | `queries/product.ts` → `browseProducts`（active ⨝ 主变体 ⨝ 该市场 vmp ⨝ 译文 ⨝ current slug + 批量附首图）/ `getProductById` / `getCategoryById` / `getBrandById` / `getCategorySubtreeIds`（BFS，**未用 ltree**） | ✅ |
| 站内搜索 | `queries/product.ts` → `searchProducts`：`productTranslations.searchVector`（generated tsvector）`@@ websearch_to_tsquery('english', $q)` + `ts_rank`；GIN `pt_search_gin`（§15.1‑5） | ✅ 参数绑定免注入；Typesense 未接（规模路径） |
| slug 单一真源 | `queries/slug.ts` → `slugify` / `getEntitySlug` / `setEntitySlug`（旧行降为历史 + 插新当前行 → 自动 301）/ `resolveSlug`（`current` \| `redirect`）/ `listCurrentSlugs`；同类型内占用冲突自动 `-2/-3` | ✅ PDP/类目/品牌/评论/CMS 五处走它 |
| 商品管理写侧 | `queries/catalogAdmin.ts` → `createProductWithVariant`（product+主变体+库存+slug+译文+发全市场算价事件）/ `setProductCatalog` / `setProductRichBody` / `upsertProductFromRow`（CSV/URL 用） | ✅ |
| 类目/品牌/属性 | `queries/category.ts` `brand.ts` `attributeAdmin.ts`（属性定义 CRUD + `setCategoryAttribute`/`removeCategoryAttribute`；值存 JSONB `attrs`） | ✅ 后台可用；属性模板引擎/facet 下发 ❌（Phase B） |
| 媒体 | `queries/media.ts` → `attachProductImage`（写 media_assets + product_images，position 自增）/ `listProductImages` / `deleteProductImage`（回 r2Key 供上层删对象）/ `moveProductImage`；URL 拼装 `core/media.ts` → `mediaUrl(r2Key)` = `MEDIA_PUBLIC_BASE + key` | ✅ |
| 富文本 | 存 ProseMirror JSON（`productTranslations.richBody` / `contentTranslations.body`），渲染统一 `apps/web/components/RichBody.tsx` | ✅ 铁律"绝不存 HTML"成立 |

### 3.5 库存
| 能力 | 位置 | 状态 |
|---|---|---|
| 水位读写 | `queries/inventory.ts` → `getStock` / `setVariantOnHand`（后台改库存） | ✅ |
| 扣减 | `shipments.ts` 内 upsert `inventory.onHand -= qty` + 写 `stockMovements.sale` | ✅ 发货时才扣 |
| **预留/秒杀** | — | ❌ 无 `inventory_reservations` 表、无 15 分钟预留、无 Redis Lua（架构文档 §6.2） |

### 3.6 定价与可售性
| 能力 | 位置 | 状态 |
|---|---|---|
| 落地价纯函数 | `core/pricing.ts` → `computeLandedPrice({goodsValue, shipping, taxRate, dutyRate, pricingMode, dutyPresentation, thresholdCents, overThresholdPolicy})` → `{taxCents, dutyCents, displayedPriceCents, allInCents, blocked}` | ✅ 6 个单测覆盖阈值分支 |
| 物化缓存 | `queries/pricing.ts` → `recomputeVariantMarketPrice`（`inputsHash` 命中即跳过；list 价变则写 `priceHistory`，reason ∈ manual/promotion/duty_recalc/fx_recalc） | ✅ |
| 事件发射 | `emitPriceRecomputeForAllMarkets`（遍历全部 markets 发 `price.recompute`）+ `updateVariantBasePrice` | ✅ **但 payload 里 taxRate/dutyRate/shippingCents=0、fxRate=1**（D01） |
| 可售性 | `core/sellability.ts` → `computeSellability` + 单测 | ⛔ **未被任何调用方使用**（D02） |
| 运费 | `core/shipping.ts` → `computeShipping(rateCard, weightG, dimsCm?, goodsValueCents)` + `core/shippingProvider.ts` Fake | 🟡 函数与单测就绪，**结账未接线**（D03） |

### 3.7 订单 / 结账
| 能力 | 位置 | 状态 |
|---|---|---|
| 购物车 | `apps/web/lib/cart.ts`（httpOnly cookie `cart` = `{variantId: qty}`，7 天）+ `queries/cart.ts` `getCartLines`（按 DB 重新取价/库存） | ✅ 无 Redis、无 carts 表 |
| 下单 | `queries/orders.ts` → `createOrder`（幂等占位 → 地址 → 批量取 vmp → 汇总 subtotal/tax/duty/shipping/discount → orders + order_items(snapshot) + order_lines → 发 `order.created`）；单号 `SO-<base36>-<3位随机>` | ✅ 连库冒烟 + e2e |
| 结账入口 | `apps/web/app/checkout/{page,actions}.tsx`（读 cookie → 事务内 `createOrder` → 清车 → 跳 `/order/[orderNumber]`） | 🟡 硬编码 market `us` / currency USD / locale en / 运费 500；异常统一 `catch → error=failed`（吞掉原因） |
| 订单查询 | `queries/orders.ts` `getOrderByNumber`；`adminOrders.ts` `listRecentOrders`/`listOrdersByCustomer`/`getOrderDetail` | ✅ |
| 游客查单 magic link / 购物车合并认领 | — | ❌ 未实现 |

### 3.8 支付与账本
| 能力 | 位置 | 状态 |
|---|---|---|
| Provider 接缝 | `core/payments.ts` → `PaymentProvider`(createCheckout/verifyWebhook/refund) + `FakePaymentProvider` | ✅ 接口就位；**Stripe/PayPal 实现 ❌**（⏸️ 待密钥） |
| webhook 接收 | `apps/web/app/api/webhooks/[provider]/route.ts`（`pickProvider` 目前恒返回 Fake + TODO 12b-2·B）：验签失败 400；`(provider, provider_event_id)` 唯一 → `onConflictDoNothing` 幂等；成功则事务内 `recordPaymentSucceeded` | ✅ 幂等已验证 |
| 支付段落账 | `queries/payments.ts` → `recordPaymentSucceeded`：建 payments + `ledger_transactions` + 借 psp_clearing / 贷 customer_deposits+tax_payable+duty_collected，**组内借贷 SUM≠0 整笔回滚**；`nextInvoiceNumber`（行锁 upsert 自增，`US-00000001` 式连号）+ 建 invoices；订单转 paid；发 `payment.succeeded` | ✅ 冒烟通过。MVP 假设本位币=订单币种（fxRate "1"） |
| 发货段确认 | `queries/shipments.ts` → `recordShipment`：借 customer_deposits / 贷 revenue+shipping_revenue；借 cogs / 贷 inventory_asset（**COGS 用 `variant.costCents` 近似**，移动平均未做）+ 扣 onHand + sale 流水 + `fulfilled` + 发 `order.shipped` | ✅ 冒烟通过 |
| 科目种子 | `queries/ledger.ts` → `STANDARD_LEDGER_ACCOUNTS` / `seedLedgerAccounts` / `requireAccountId` | ✅ |
| 退款/争议/payouts/发票 PDF/关税对账 | 表在，代码无 | ❌ |

### 3.9 outbox / relay / cron / 保留
| 能力 | 位置 | 状态 |
|---|---|---|
| 事件表读写 | `queries/outbox.ts` → `emitEvent` / `fetchPendingEvents` / `markDispatched` / `markFailed`（attempts 累加，超阈值 dead） | ✅ |
| relay 引擎 | `packages/jobs/src/relay.ts` → `runRelayBatch(db, handlers, {limit})`：按 `eventType` 查注册表；**未知类型直接 ack**（防堵队） | ✅ |
| handler 注册表 | `packages/jobs/src/handlers.ts` → 目前**只有 `price.recompute`** 一条（`order.created`/`payment.succeeded`/`order.shipped` 会被 ack 丢弃 = 无下游动作） | 🟡 |
| Cron Worker | `apps/jobs/index.ts`：`scheduled` 每分钟跑 relay（`RELAY_BATCH_LIMIT` 默认 500）；`event.cron === "20 4 * * *"` 分流跑 `runDataRetention`；`fetch /health` 回 outbox pending 数 | ✅ 已部署 |
| 写时自派发 | `apps/admin/app/products/[id]/actions.ts` + `products/import/actions.ts` 提交后 `ctx.waitUntil(runRelayBatch(...))` | ✅ 秒级生效，Cron 兜底 |
| 数据保留 | `queries/retention.ts` → `runDataRetention`（idempotency_keys 过期 / outbox dispatched>90d / webhook>90d，各 `.returning({id})` 计数；不碰账本/库存/会话） | ✅ 冒烟 + tsc |

### 3.10 SEO 前台
| 能力 | 位置 | 状态 |
|---|---|---|
| seo_meta 稀疏覆盖 | `queries/seo.ts`（回退链 `(locale,market)` → `(locale, NULL)`；**全空即删行**；因唯一索引含可空 marketId 故用"查在则改"代替 ON CONFLICT）+ `apps/web/lib/seo.ts` `applySeoMeta` | ✅ |
| JSON-LD（4 处） | 首页 `app/page.tsx`（`WebSite` + `Organization`）· PDP `products/[slug]`（`Product` + `Offer`，availability 按库存）· 类目页 / 品牌页（`BreadcrumbList`）。**`layout.tsx` 不含 JSON-LD**；PDP 自身无面包屑结构化数据 | ✅ 类目/品牌有面包屑；PDP 面包屑 schema ❌ |
| sitemap | `apps/web/app/sitemap.ts`（Next 原生、`force-dynamic`：首页 + /products + 全 active PDP + 类目 + 品牌） | 🟡 **不含 /blog 与 page/landing 内容页**（CMS 上线后未回补）；未做 R2 分片（文档 §10.1 规模路径） |
| robots | `apps/web/app/robots.ts`（disallow `/account` `/cart` `/checkout` `/api` + sitemap 挂载） | ✅ |
| 面包屑/404/错误边界 | `not-found.tsx` / `error.tsx` / `global-error.tsx` | ✅ |
| 安全响应头 | `apps/web/next.config.ts`（nosniff/X-Frame-Options/Referrer-Policy/Permissions-Policy/HSTS；`images.unoptimized`，**CSP 未加**需 nonce） | 🟡 |
| Cookie 同意 | `apps/web/components/CookieConsent.tsx` + `CookieSettings.tsx` + `lib/consent.ts`（第一方 cookie 存 `cookie_consent`，180 天，version 化，可撤回；未同意不加载非必需脚本） | ✅ 登录用户同意入 `consents` 表 ❌ 未接 |
| hreflang / 多币种 / RTL / Merchant feed | — | ❌（架构文档 §10，属"待多语言启用"） |

### 3.11 ISR 与缓存
| 项 | 位置 | 状态 |
|---|---|---|
| 增量缓存 | `apps/web/open-next.config.ts`：`withRegionalCache(r2IncrementalCache, {mode:"short-lived"})` + `queue: doQueue` | ✅ 两级（R2 持久 + Cache API 区域快层） |
| 绑定 | `apps/web/wrangler.jsonc`：`NEXT_INC_CACHE_R2_BUCKET=onestarry-isr-cache`、`NEXT_CACHE_DO_QUEUE`/`DOQueueHandler` + migrations、`WORKER_SELF_REFERENCE` | ✅ |
| **Tag Cache** | **未配**（注释明确"B 只用时间 revalidate"）→ 全站**零 `revalidateTag`/`unstable_cache` 调用**，失效只能等 60s 到期或后台 `revalidatePath`（后台自身页面） | 🟡 与架构文档 §10.2 L3/失效链路、§15.1‑2 的"on-demand revalidate"有意偏离 |
| 页面策略 | 内容页 `export const revalidate = 60`（PDP/类目/品牌/blog/内容页）；交易/账户页 `dynamic = "force-dynamic"`（cart/checkout/order/account/search/integration） | ✅ |
| Hyperdrive 查询缓存 | 未在 Hyperdrive 配置里开 `caching_enabled` | ❌ 文档 L2 未落地 |

### 3.12 CMS（步骤 15 后补的欠账）
| 项 | 位置 | 状态 |
|---|---|---|
| 查询层 | `queries/content.ts`：`listContent`/`getContentForEdit`/`upsertContent`（body 传了才更新，防误清空）/`updateContentBody`/`setContentStatus`（首发盖 publishedAt）/`deleteContent`（连带清 slugs）/`getPublishedContentBySlug`（历史 slug→`{redirect}`）/`listPublishedContent` | ✅ 连库冒烟全通过 |
| 后台 | `apps/admin/app/content/{page,[id],actions,ContentEditor}.tsx`（5 动作全 `requirePermission(seoWrite)`；Tiptap StarterKit 存 JSON） | ✅ 阶段1 |
| 前台 | `/blog`、`/blog/[slug]`、`/[slug]`（page/landing 单段动态，具名段优先不劫持，blog 归一 `/blog` 前缀） | ✅ 本地 dev 渲染验证 |
| 阶段2/3 | landing 可拼接块 / 编辑器插图 / content 的 seo_meta 面板 | ⏳ 未开工 |

### 3.13 评论
| 项 | 位置 | 状态 |
|---|---|---|
| 查询 | `queries/reviews.ts`：`listApprovedReviews`（平均+计数+脱敏 author）/`createReview`（**verifiedPurchase = 该客户是否有含此商品的 paid/completed 订单**；rating 越界拒）/`listReviewsForModeration`/`setReviewStatus` | ✅ |
| 前台 | `/products/[slug]/review`（page+actions，登录用户提交 → pending） | ✅ |
| 后台 | `/reviews` 审核页（`requirePermission(productWrite)`） | ✅ |
| 聚合评分物化到商品 / 投票 / 问答 / 反刷 | — | ❌ 未做 |

### 3.14 导入（CSV + URL 抓品）
| 项 | 位置 | 状态 |
|---|---|---|
| CSV | `core/csv.ts` `parseCsv`/`csvToObjects` → `apps/admin/app/products/import/{page,ImportForm,actions}.ts`（按 SKU upsert、`imageUrl` 自动下载转存 R2、行数上限、末尾 `runRelayBatch` 重算全包价） | ✅ |
| URL 抓品 provider | `apps/admin/lib/importProviders.ts`：`detectSource`（taobao/tmall/1688/alibaba → `taobao`；`*.myshopify.com` → `shopify`；其余 `generic`）+ `fetchProductFromUrl`（Shopify `/product.json`、JSON-LD `schema.org/Product`、OpenGraph 三级解析）→ `ProductImportDraft`；**淘宝/1688 返回 `needsProvider`**（反爬+登录墙，留专用 API 插槽）+ `enrichWithLlm` 插槽 | ✅ 抓自身 PDP 验证：标题/价格/图/SKU 全对 |
| 落地 | `importFromUrlAction`（`requirePermission(productWrite)`）→ 建 draft 草稿 → 抓图转存 R2 → 返回 productId 跳编辑页人工审核 | ✅ |
| 自动分类 | `categoryHint` 已抓但**未挂到我们的 categories** | ⏳ |

### 3.15 对外集成 API（步骤 14）
| 项 | 位置 | 状态 |
|---|---|---|
| 访问校验 | `apps/web/app/integration/_lib/access.ts` → `checkAccess`：看 `cf-access-authenticated-user-email` / `cf-access-jwt-assertion` 头，缺 → 401 | 🟡 **骨架级**：JWKS 严格验签未做（生产前必补） |
| 读 | `GET /integration/demand`（`queries/integration.ts` `getDemandFeed`：已付 + 未发/部分发订单，按 variant 聚合 sku/hsCode/countryOfOrigin/quantity，**无 PII**）；`GET /integration/inventory`（`getInventoryLevels`，`coalesce(available,0)`） | ✅ |
| 写 | `POST /integration/stock/receive` → `receiveStock`：upsert onHand + `stockMovements.receive`（带 unitCostCents/currency/supplierRef/externalPoRef 到 note）+ damaged 另写 `damage` 流水；`Idempotency-Key` + scope `integration.receive` 命中即 deduplicated | ✅ 本地 dev 端到端 401/201/幂等/回写验证 |
| 账本分录（借 inventory_asset / 贷 external_ap_clearing） | `receiveStock` 内 TODO(§13) | ⛔ |
| OpenAPI + zod 契约进 `packages/shared` | — | ❌ |
| "销售速度"派生指标（`daily_sales_stats` rollup） | — | ❌ 表都没建 |

### 3.16 后台页面清单（18 页 · 守卫级别如实标注）
| 路由 | 页面守卫 | 动作守卫 |
|---|---|---|
| `/`（概览） | requireAdmin | — |
| `/products` `/products/[id]` `/products/new` `/products/import` | requireAdmin | import=`productWrite`；`new` 与 `[id]` 的 **10 个动作仅会话** ⚠️ |
| `/orders` `/orders/[id]` | requireAdmin | `markShippedAction` **仅会话** ⚠️（涉收入确认+扣库存） |
| `/categories` `/categories/[id]/attributes` | requireAdmin | 仅 requireAdmin ⚠️ |
| `/brands` `/attributes` | requireAdmin | 仅 requireAdmin ⚠️ |
| `/legal` | requireAdmin（且**不在 AdminNav**，需手输 URL） | 仅 requireAdmin ⚠️ |
| `/content` `/content/[id]` | **requirePermission(seoWrite)** | 同 ✅ |
| `/reviews` | **requirePermission(productWrite)** | 同 ✅ |
| `/markets` | requireAdmin（页面可见） | `createMarketAction`=`marketWrite` ✅ |
| `/team` | **requirePermission(roleManage)** | 3 动作全 `roleManage` ✅ |
> AdminNav 10 个入口**不按权限过滤**（staff 能看到"市场/团队"链接；团队页会抛 FORBIDDEN，市场页能进但提交被拒）。

### 3.17 前台页面清单
`/`（首页 Hero/分类入口/精选/信任条）· `/products` `/products/[slug]` · `/search` · `/categories` `/categories/[slug]` · `/brands` `/brands/[slug]` · `/blog` `/blog/[slug]` · `/[slug]`（page/landing）· `/cart` · `/checkout` · `/order/[orderNumber]` · `/account/orders` · `/signin` · `/legal/[type]`（terms/privacy/returns/withdrawal）· `/api/{health,db-check,auth/[...all],webhooks/[provider]}` · `/integration/*`
缺：收藏/心愿单、退货 RMA、订单取消、地址簿、多语言路径。

---

## 4. 权限守卫覆盖矩阵（P0）

| 写动作 | 文件 | 当前守卫 | 应有权限点 |
|---|---|---|---|
| 改基价 / 上下架 / 改库存 / 传图 / 删图 / 移图 / 存富文本 / 存 SEO / 挂类目品牌 | `app/products/[id]/actions.ts`（10 个） | **仅 `getSession`** | `product:write`（SEO 那个 `seo:write`） |
| 新建商品 | `app/products/new/actions.ts` | 仅 `getSession` | `product:write` |
| **标记发货**（账本+库存） | `app/orders/[id]/actions.ts` | 仅 `getSession` | `order:write` |
| 类目增改 / 类目↔属性挂载 | `app/categories/**` | `requireAdmin`（无权限点） | `category:write` |
| 品牌增改 / 属性定义增删改 | `app/brands` `app/attributes` | `requireAdmin` | `category:write` |
| 法律文档保存 | `app/legal` | `requireAdmin` | `seo:write` |
| 内容 CRUD/发布 | `app/content` | ✅ `seoWrite` | — |
| 评论审核 | `app/reviews` | ✅ `productWrite` | — |
| 市场创建 | `app/markets` | ✅ `marketWrite` | — |
| 团队/角色 | `app/team` | ✅ `roleManage` | — |
| CSV/URL 导入 | `app/products/import` | ✅ `productWrite` | — |

**风险评估**：当前 staff 角色恰好拥有 product/order/category/seo 四点，所以**今天没有实际越权损失**；但：① 违反架构文档铁律②"每个 Server Action 内部强制 authz"；② 一旦新增低权角色（客服/只读/外包运营）就会立刻全线破防；③ 退款/争议等敏感动作将来接上时容易漏加。**建议**：全站统一改 `requirePermission(...)`（上表"应有权限点"），并把 AdminNav 按权限过滤，作为模板的**硬约束范式**（模板的价值就在于后人照着写不出错）。

---

## 5. 部署 / 运维现状

| 项 | 真相 |
|---|---|
| Workers | `onestarry-com`（web）· `onestarry-admin`（admin）· `onestarry-jobs`（cron，crons `* * * * *` + `20 4 * * *`） |
| 绑定 | web：Hyperdrive `797e79…` + R2 `onestarry-media` + R2 `onestarry-isr-cache` + DO `NEXT_CACHE_DO_QUEUE` + service 自引用；admin：Hyperdrive + R2 `onestarry-media`；jobs：仅 Hyperdrive |
| CI | **Cloudflare Workers Builds**（三 Worker 各自"就地连接 Git"，push main 自动构建）；**无 `.github/workflows`** → lint/typecheck/test 只在本地跑 |
| R2 桶 | 只有**公开桶** `onestarry-media`（+ ISR 桶 `onestarry-isr-cache`）；架构文档 §10.3 计划的**私有桶 `onestarry-files` 未建**（发票 PDF/导入暂存/未发布上传无处可放） |
| 图片管线 | 客户端 `apps/admin/lib/image.ts` `downscaleImage`（最长边 ≤1600 → webp q0.82）→ Server Action 上传 R2；URL 导入侧 `importImage` 下载外链转存 R2。**无 Cloudflare Images/缩略变体** |
| DB 角色 | `app_rw` 已上线（只追加表禁 UPDATE/DELETE；outbox 保 UPDATE；orders 保 DELETE）；DDL 走 `neondb_owner` |
| 备份 | Neon PITR（套餐保留期待核）+ **手动** `pg_dump`；定时冷备 ❌（Worker 不能 exec pg_dump，需 GitHub Actions 定时 workflow） |
| 可观测 | Cloudflare 内置 Web Analytics + Workers Issues + Observability/RUM；Sentry/Axiom/OTel/PostHog/Better Stack ❌ 全未接 |
| DR | `docs/DR-RUNBOOK.md`（4 类恢复场景 + Hyperdrive 体检 + 角色约束 + 🟩/🟨/🟥 标注） |
| 换皮 | `docs/REBRAND.md`（site.ts / 域名 / Worker 名 / R2 桶 / Hyperdrive ID / DO tag / seed / 法条 清单 + 验证脚本） |

---

## 6. 数据与脚本

| 脚本 | 命令 | 做什么 |
|---|---|---|
| `db/src/seed-ledger.ts` | `pnpm --filter @onestarry/db seed:ledger` | 标准账本科目 |
| `db/src/seed-demo.ts` | `seed:demo` | **1 个市场 `us`**（`pricingMode=net_plus_tax`, `dutyPresentation=separate_line`）+ 1 法人 + 3 商品（ceramic-mug/linen-tote/steel-bottle，含库存/slug/译文/vmp）；税/关/运费传 0 |
| `db/src/seed-catalog.ts` | `seed:catalog` | 2 类目（drinkware/bags）+ 2 品牌 + 挂 3 个 demo 商品 |
| `admin/scripts/seed-admin.ts` | `pnpm --filter @onestarry/admin seed:admin` | 超管（密码读环境变量） |
| 便捷入口 | `pnpm seed:all`（ledger→catalog→demo→admin）· `pnpm db:partition` · `pnpm db:studio` | |
| smoke（11 个，`db/src/smoke-*.ts`） | `smoke` / `smoke:catalog` / `smoke:inventory` / `smoke:pricing` / `smoke:outbox` / `smoke:orders` / `smoke:create-order` / `smoke:payments` / `smoke:payments-posting` / `smoke:shipment`（另有 `jobs/src/relay.smoke.ts`、`jobs/smoke-admin-pricing.ts`） | 连真实 Neon 冒烟，人工触发 |
| 连接 | 根 `.env.local`（`DATABASE_URL` 池化 / `DATABASE_URL_UNPOOLED` 直连），seed 用 `dotenv config({path:"../../.env.local"})` | ⚠️ 从不同 cwd 跑脚本时路径解析会失效 |

**本地开发**：`pnpm dev`（turbo 并行起 web + admin，各自 `next dev` 默认 3000，冲突时后者自动进位到 3001；jobs 用 `wrangler dev`）。`apps/web/lib/db.ts` `getDb()` 在无 `getCloudflareContext()` 时回退 `process.env.DATABASE_URL`，所以前台页面可直接 `next dev` 渲染真实数据（**日常验证首选，秒级**）。

---

## 7. 测试现状

| 层 | 真相 |
|---|---|
| 单测 | `packages/core/src/*.test.ts` **6 个**（pricing/sellability/shipping/shippingProvider/payments/csv），跑法 `tsx --test`（**node:test，不是 Vitest**）；`pnpm --filter @onestarry/core test` |
| turbo | `turbo.json` **无 test 任务** → `pnpm test` 不进流水线 |
| 集成 | 靠 11 个 smoke 脚本连真实 Neon（人工触发） |
| e2e / 压测 / a11y | Playwright ❌ k6 ❌ axe ❌（架构文档 §12 要求，未开工）；历史上用浏览器子代理手工点过结账（截图已 gitignore） |

---

## 8. 完成度对照架构文档 18 步

| 步骤 | 状态 | 说明 |
|---|---|---|
| 1 Monorepo/工具链 | ✅ | Turborepo/pnpm/TS strict/Tailwind v4/eslint；boundaries 插件 ❌ |
| 2 OpenNext 部署 | ✅ | 三 Worker 上线 + ISR/Hyperdrive/DO 全通 |
| 3 db 基础设施 + 异步 | ✅ | Drizzle+Hyperdrive+UUIDv7+迁移+角色分离+分区（**Inngest → Workers Cron**） |
| 4 配置底座 | 🟡 | 表全建、`markets` 列（pricing_mode/duty_presentation/over_threshold_policy）**在用**；其余 12 张配置表 ⛔ 零代码 |
| 5 账本+发票序列 | ✅ | 两段式分录+连号取号+借贷平衡校验 |
| 6 认证与 RBAC | 🟡 | 双实例+三档+权限点表 ✅；§4 的守卫缺口 + 无 2FA/step-up/审计 |
| 7 商品目录 | ✅ | 含属性定义/slug 单一真源/媒体/译文；变体矩阵 `productOptions/optionValues` ⛔ 未用 |
| 8 库存 | 🟡 | 水位+流水+发货扣减 ✅；预留/原子扣减/秒杀 ❌ |
| 9 定价与可售性 | 🟡 | 物化管道+inputsHash+price_history ✅；四个 provider 占位（D01）、`computeSellability` 未接（D02） |
| 10 搜索与 outbox | ✅/🟡 | outbox+relay+cron+写时自派发 ✅；搜索用 Postgres FTS（Typesense 为规模路径），handler 只有 1 条 |
| 11 结账与订单 | 🟡 | 主链通 ✅；幂等/运费/市场硬编码 + 无预留 + 无 magic link（D03） |
| 12 支付与税务关税 | ⏸️ | Fake PSP 全链路通；Stripe/PayPal/Tax/LandedCost 待密钥；disputes 落库❌ |
| 13 履约·发票·邮件 | 🟡 | `recordShipment` + 后台标记发货 ✅；物流商 API/PSP 运单同步/发票 PDF/Resend 邮件/退货 ❌ |
| 14 对外集成 API | ✅ | 三端点 + 幂等 + Access 骨架（JWKS 严格验签待补） |
| 15 Admin | 🟡 | 18 页覆盖商品/订单/目录/属性/评论/内容/市场/团队/法律/导入；税则·运费·合规·PSP 配置页 ❌ |
| 16 前台与 SEO | 🟡 | ISR/seo_meta/JSON-LD/sitemap/robots/同意/法律页/404 ✅；hreflang·多币种·RTL·Merchant feed ❌ |
| 17 可观测与护栏 | 🟡 | 数据保留 job + DR runbook + CF 内置观测 ✅；Sentry/合成结账/k6 ❌ |
| 18 模板化收尾 | ✅ | README/.env 样板/REBRAND/seed 幂等/便捷脚本/tag `template-v1.0` |

---

## 9. ⛔ 未接线清单（照此顺序补，不用重新找）

| # | 缺口 | 接线位置（现成锚点） |
|---|---|---|
| N1 | Stripe Provider 实现 | `core/payments.ts` 加 `StripeProvider implements PaymentProvider` → `webhooks/[provider]/route.ts` 的 `pickProvider` TODO(12b-2·B) |
| N2 | 税/关费率 | `queries/pricing.ts` `emitPriceRecomputeForAllMarkets` 里 4 个占位字段 → 改为读 `dutyRules`/`taxRatesConfig`/`deMinimisRules`（表已存在）或 Stripe Tax 响应 |
| N3 | 运费进结账 | `core/shipping.ts` `computeShipping` + `shipping_rates.rate_table` 已在；调用点在 `web/app/cart/page.tsx` 与 `checkout/actions.ts` 的 `SHIPPING_CENTS = 500` 处替换 |
| N4 | 可售性接线 | `core/sellability.ts` → `browseProducts`/`getProductById`/`getCartLines` 三处读取路径 + `product_market_availability` 表启用 |
| N5 | 真实幂等键 | `checkout/actions.ts`：由客户端提交前生成并复用（同一表单一次提交一个 key），命中 `IDEMPOTENT_REPLAY` 时返回原单号 |
| N6 | 权限守卫统一 | §4 表格逐文件改 `requirePermission`；`AdminNav` 按 `getPrincipalPermissions` 过滤 |
| N7 | 内容页进 sitemap | `apps/web/app/sitemap.ts` 加 `listPublishedContent` 的 blog/page/landing |
| N8 | 退款 | 新建 `queries/refunds.ts`（表已存在）+ 后台退款动作（`refund:write`）+ `creditNotes` |
| N9 | 交易邮件 | `packages/email`（未建）+ 新增 outbox handler：`order.created/payment.succeeded/order.shipped`（`jobs/src/handlers.ts` 注册表就是为此留的） |
| N10 | 发票 PDF → 私有桶 | 建 `onestarry-files` 桶 + `FILES` 绑定 + `invoices.pdfKey`（列已在 foundation/invoices？若无则字段级迁移） |
| N11 | 入库成本分录 | `queries/integration.ts` `receiveStock` 内 `TODO(§13)` |
| N12 | pg_dump 定时冷备 | Worker 不能 exec → 需一条 GitHub Actions schedule（本仓当前无 `.github/`） |
| N13 | 集成 API 严格验签 | `integration/_lib/access.ts` 补 JWKS 校验 + scope + IP allowlist |
| N14 | CMS 阶段2/3 | `ContentEditor` 加 Image 扩展 + 上传 action（R2 key `content/{contentId}/`）；content 的 seo_meta 面板复用 `upsertSeoMeta` |
| N15 | 测试进流水线 | `turbo.json` 加 `test` 任务；（可选）把 `tsx --test` 换 Vitest 以对齐文档，或改文档 §12 |

---

## 10. 偏差登记表（架构文档 ↔ 代码，逐条）

| # | 文档位置 | 文档说的 | 代码做的 | 影响 | 处置建议 |
|---|---|---|---|---|---|
| D01 | §3.3/§6.1 | 全包价 = 基价+税+关+运费，税由 Stripe Tax/LandedCost 权威 | `taxRate/dutyRate/shippingCents=0`、`fxRate=1` 硬编码进事件 payload | 展示的"全包价"其实没有税关；US DDP 不成立 | 见 N2；在此之前架构文档 §3.3 标"MVP 占位" |
| D02 | §5 | `computeSellability` 是四处共用的单一函数 | 零调用；可售性只看 vmp.blocked + status | 商品级市场可用性/禁售类目/配送区覆盖**不生效** | 见 N4 |
| D03 | §6.1/§6.6 | 结账必算运费、进 VAT 税基、整票阈值分支 | 运费 500 常量、无阈值校验、市场硬编码 us | 多国/多市场立刻失真 | 见 N3/N5 |
| D04 | 铁律②/§7 | 每个 Server Action 强制 authz | 商品/发货/新建/类目/品牌/属性/法律页只校验登录 | 低权角色一旦上线即全线破防 | 见 N6（**模板级 P0**） |
| D05 | §14 | 加国家 = 纯配置（运费/税则/合规/PSP 全后台配） | 只有 `markets` 行 + 后台"市场创建"；其余配置表无读代码、无配置页 | "纯配置加国家"目前**不成立** | 分两步：先接线（N2/N3/N4），再补后台配置页 |
| D06 | §1/§43 §2/§58/§162 | 异步层 = Inngest | Workers Cron + `runRelayBatch`；handler 仅 1 条 | 文档误导后来人 | 文档已在本轮回写（见 §11） |
| D07 | §1 L37/§5/§10 | 搜索 = Typesense 默认，outbox → Typesense | Postgres FTS（generated tsvector + GIN）；无外发 | 分面/容错/即时建议客户端直连都没有 | 保留为规模路径（§15.1‑5 已注明阈值） |
| D08 | §1 L38/§6.2 | 缓存 = Upstash Redis（购物车/会话/限流/秒杀） | 未引入；购物车 = httpOnly cookie | 结账限流、秒杀预扣不存在 | 上线前补限流（Turnstile + rate limit）；Redis 标"按需" |
| D09 | §1 L45/§13 | 邮件 = Resend + React Email | 完全未开工 | 下单/发货/退款无通知；`consents` 无写入方 | 见 N9 |
| D10 | §10.2 L245-249 | ISR 三件套含 **D1 Tag Cache** + revalidateTag + 边缘 purge | 只配 R2 + regional + DO queue，**无 tagCache、零 revalidateTag** | 后台改动最多陈旧 60s；无法即时失效 | 有意取舍（文档"方案 B"）；要即时生效就补 D1 + L3.1 purge |
| D11 | §10.3 L278-279 | "R2 现状 = 无读写代码、桶内空" | **已过时**：media.ts/上传动作/URL 抓图/公开域 `media.onestarry.com` 全在用 | 文档误导 | 本轮已回写 |
| D12 | §12/§1 | core Vitest / CI GitHub Actions | `tsx --test` + Workers Builds；无 workflow、turbo 无 test 任务 | 测试不会自动跑 | 见 N15 |
| D13 | §3.7 | customer 业务属性进 `customer_profiles` | 表在，零引用（前后台都没读写） | 偏好语言/市场/营销开关无处落 | 接前台偏好时一并启用 |
| D14 | §13 | 集成契约 zod 单一真源进 `packages/shared` + OpenAPI | `packages/shared` 是**空壳**（package.json 指向不存在的 src） | 外部程序无契约可依 | 要么补 shared/src，要么从文档删掉这条承诺 |
| D15 | §7/§15.2 | 后台强制 2FA/Passkey、审计 diff、财务限额 | 全 ❌；且后台 admin 实例**未关闭公开注册** | 后台账号可被自助注册（有 Hyperdrive 即可写） | **上线前必核**：`disableSignUp` + 团队页审批流 |

---

## 11. 与架构文档的同步约定

- 架构文档负责 **决策与顺序**；本文件负责 **位置与状态**。改代码若动了某模块的"有/无/占位"，**只更新本文件的对应行**，架构文档仅在决策变化时改。
- 本文件的 §10 是"文档 vs 代码"差异的**唯一登记处**；架构文档正文相应位置已加「实现现状」注并指向本节。
- 更新方法（都基于真实扫描，不手写印象）：
  ```powershell
  # 表清单 / 查询层导出全景 / 后台守卫覆盖
  Select-String -Path packages/db/src/schema/*.ts -Pattern '^export const (\w+) = pgTable'
  Select-String -Path packages/db/src/queries/*.ts -Pattern '^export (async function|const) (\w+)'
  Select-String -Path apps/admin/app/**/actions.ts -Pattern 'requirePermission|requireAdmin|getSession'
  ```
