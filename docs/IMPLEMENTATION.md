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

**五个"看着有、其实没通电"的关键点 + 一个已收口的 P0**（详见 §10 偏差登记表）：

| # | 事项 | 真相 |
|---|---|---|
| D01 | 税/关税/运费/汇率 | `taxRate:0 / dutyRate:0 / shippingCents:0 / fxRate:1` **硬编码占位**（`queries/pricing.ts` L152-159）→ 现在"全包价 = 基价原样" |
| D02 | `computeSellability` | ✅ **已接进 createOrder**（上次 H-2）：黑名单 `product_market_availability.mode='deny'` + `products.status` + 库存（in_stock_only）均过它；`smoke:sellability` 实测。**残余**：`shipsTo` 写死 true 未查 `shipping_zones`（M-11）、白名单 allowlist 有意不启用（防断收入） |
| D03 | 结账 | 运费**硬编码 500 分**、市场**硬编码 `us`**；~~无库存预留~~ **已实现下单原子占位（审查 H-2）**：`reserved` 生命周期 + 未付过期回收 cron（详 §3.5）；`idempotencyKey` 已由结账页渲染时生成并回带（不再每次现取） |
| D04 | 权限点强制 | ✅ **已于 2026-10-21 收口**（原先：34 个后台写动作中仅 12 个校权限点）。现**全 34 个动作 = `requirePermission(...)`**，13 个页面同步升级，AdminNav 按权限过滤（详 §4） |
| D05 | 底座配置表 | **12 张表有表无代码**（shippingZones/shippingRates/carriers/dutyRules/taxRatesConfig/taxRegistrations/deMinimisRules/marketComplianceProfiles/paymentProviderAccounts/locales/marketCountries/marketLocales + promotions/customerProfiles/consents 部分）→ §14"加国家=纯配置"目前**只在 markets 表列层面成立** |
| D06 | 步骤 13 邮件/退款/争议/PDF | `Resend`、`refunds`、`disputes`、`payouts`、发票 PDF → R2 **全部无实现**；退款权限点 `refund:write` 定义了但没有退款动作 |

**术语已过时**（架构文档正文仍这么写，代码已替代）：Inngest → **Workers Cron**；Typesense → **Postgres FTS**；Upstash Redis → **未使用**；Vitest → **node:test（tsx --test）**；GitHub Actions → **Cloudflare Workers Builds**；`packages/email`/`packages/authz`/`tools/scraper` → **不存在**。

**作为一份可交付模板，还欠 22 项**（→ **§12 模板完备性体检**，T1–T22 分四组：换皮彻底性 / 质量门禁 / 安全默认值 / 版本时间炸弹。本轮（2026-10-21）已**结案 T3/T5/T7**（其中 T7 后根 `pnpm typecheck` 首次 8/8 全绿）、**仓库侧门禁 T8 已建**（待你改一次 CI 命令）、过桥 T17 已落地；本轮又新发现 **T22：lint 面从未接通**）。

---

## 1. 仓库布局实况

```
onestarry.com/
├── apps/
│   ├── web/        前台（Next 16 + OpenNext → Worker `onestarry-com`）  51 个 ts/tsx
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
| `drizzle/manual/0014_partition_append_only.sql` | `ledger_entries` + `stock_movements` 重建为 RANGE 月分区（幂等，经 `pnpm db:partition` 应用）。**已补（审查 M-9）**：末尾遍历 `pg_inherits` 给每个子分区补 `REVOKE UPDATE, DELETE`，并自带 `SET LOCAL lock_timeout='3s'` 保险丝。⚠ **第 76 行把 `stock_movements.variant_id` 外键建成 `ON DELETE CASCADE`** —— 该缺口由 0017 改为 RESTRICT（新建库跑完 0014 后必须跟跑 0017）。**M-9 已于 2026-10-29 在生产回填并复核**：28 张子分区 `UPDATE/DELETE` 全 false（`pnpm db:hardening` 输出） |
| `drizzle/manual/0015_app_role.sql` | `app_rw` 角色 + 只追加表 REVOKE UPDATE/DELETE（**已在 Neon 执行、Hyperdrive 已切换**）。⚠ **审查 M-9 已核为真**：此处 `GRANT ... ON ALL TABLES` 会把 UPDATE/DELETE 授给**每张已存在的叶分区**，而 `REVOKE` **只撤两张父表**——PG 中 REVOKE 父表**不传导到分区**，实测 `has_table_privilege('app_rw', 叶, 'UPDATE')=true`（父=false）。因应用只点名父表，**主路径已被挡住**，故属 defense-in-depth 缺口；叶级补撤已固化进 0014，**已于 2026-10-29 回填现网并实测复核**（见上行 + §12） |
| `drizzle/manual/0016_role_timeouts.sql` | **新增（2026-10-29）**：给 `app_rw`/`neondb_owner` 配 `idle_in_transaction_session_timeout` / `lock_timeout` / `statement_timeout` 三根保险丝。此前全仓**从未设过**任何超时（三个 GUC 均默认 0=永不超时），叠加“cron 保活使 compute 从不 suspend”，导致**卡住的会话不会自行回收、抢不到锁的 DDL 会无限排队并拖垮整库** → 手动 Restart compute 成为唯一逃生门。本文件把它变成自愈。**已于 2026-10-29 在生产执行并回读核验**（`pg_roles.rolconfig` 已读到上述值）。两条关键前提已核：① `drizzle.config.ts` 用 `DATABASE_URL_UNPOOLED ?? DATABASE_URL`，即**迁移走 neondb_owner**，而 owner **故意不设** statement_timeout → 慢 DDL（大表建索引等）**不会被 30s 误杀**；② `.env.local` 里 `DATABASE_URL`（池化）与 `DATABASE_URL_UNPOOLED` 两个**都是 neondb_owner**，`app_rw` 只存在于 Hyperdrive 绑定里——即 30s 上限**只作用于 Hyperdrive 运行时路径**（web/admin/jobs），该路径无合法长跑单语句（relay 每事件各自小语句；admin 聚合页实测 0.5–1.3s）。`ALTER ROLE` 只影响**新建会话**，Hyperdrive 池会随连接回收逐步带上。⚠ **当时登记的那颗延迟炸弹已收口（2026-10-29）**：`queries/retention.ts` 每日 cron 原为**无界 `DELETE ... RETURNING`**，行数长大会顶到 30s 而**整条被杀**（于是清理天天失败、三张临时表反而无限增长）——已改成 `WHERE id IN (SELECT ... LIMIT 5000)` 的批间循环（每张表每次最多 20 批，抵顶报 `capped` 留给明天），**而不是调大超时**；连库取证见 `smoke:retention`。`app_rw` 对这三张表有 DELETE 权（仅 ledger/stock 被 REVOKE） |
| `drizzle/manual/0017_append_only_hardening.sql` | **新增（2026-10-29，审查 M1）**：补齐「只追加 / 已开具凭证不可改写」这条不变量的三个缺口 —— ① 0015 只 REVOKE 了 `ledger_entries`+`stock_movements`，而 `ledger_transactions` 带着 `reference_type/reference_id`（分录↔payment 的对应关系），app_rw 一直能改：把头改指到别的 id，分录就和那笔钱脉脱钩而账仍借贷平衡；② `invoices` / `credit_notes` 是法务凭证也未入名单；③ `stock_movements.variant_id` 是 `ON DELETE CASCADE`，而 **PG 的级联删除不检查子表权限** ⇒ 光 REVOKE（父表与叶都算）挡不住 `DELETE FROM product_variants` 抹掉整段库存流水。**连库实证**：改前删一个带流水的变体 `deleted=true`、流水剩余 **0**（洞是活的）；改后报 23001 `violates RESTRICT setting of foreign key constraint "sm_variant_fk"`、流水剩余 1。前提已核：全仓无任何代码 `UPDATE/DELETE` 这四张表或删 `product_variants`（grep 零命中）⇒ 纯收紧、不改应用行为。由 `pnpm db:hardening` 应用并自带 BEFORE/AFTER 对照断言（含 M-9 叶复核）。⚠ **未验证到的一点**：想以 `SET LOCAL ROLE app_rw` 做行为级实证被 42501 拒（neondb_owner 不是 app_rw 成员），所以 app_rw 侧结论来自 `has_table_privilege` 而非真跑一条 UPDATE。⚠ **长期陷阱**：0015 的 `ALTER DEFAULT PRIVILEGES` 会给以后每张新表自动授 UPDATE/DELETE —— 新建只追加表时必须显式 REVOKE，默认权限不会替你拦 |

> ⚠️ `0014_partition_append_only.sql` 与生成的 `0014_melodic_human_torch.sql` **同序号不同来源**，新库按 `drizzle/migrations` journal 走 `db:migrate` 后再单独跑 `db:partition`；**然后必须跟跑 `db:hardening`（0017）** —— 0014 把 `stock_movements` 外键建为 CASCADE、又把 UPDATE/DELETE 默认授给了新叶，不跑 0017 就等于 M1/M-9 两个缺口还在。重建模板站时顺序不可颠倒。

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
| 路由 | `apps/web/app/api/auth/[...all]/route.ts`、`apps/admin/app/api/auth/[...all]/route.ts` | ✅ 前台开放注册；✅ **后台 HTTP 层封公开注册**（`lib/authGuard.ts` `isBlockedPublicAuthPath` → `/sign-up*` 一律 403）。⚠️ 故意**不用** better-auth 的 `disableSignUp`：它会连进程内 `auth.api.signUpEmail` 一起拒，而团队页建员工/seed-admin 正是走进程内调用（已核 better-auth 1.7.10 `sign-up.mjs:145`） |
| 客户端 | `packages/auth/src/client.ts` → `makeAuthClient`（后台登出用） | ✅ |
| 登录页 | 后台 `apps/admin/app/signin/page.tsx`（中文、无注册入口 UI）；前台 `apps/web/app/signin/page.tsx`（最简 demo，Sign up/Sign in/Sign out） | 🟡 前台页 UI 未设计化 |
| 2FA/Passkey/step-up/IP 告警 | — | ❌ 架构文档 §7 要求，未实现 |

### 3.3 授权 RBAC
| 项 | 位置 | 状态 |
|---|---|---|
| 权限点/角色单一真源 | `packages/core/src/rbac.ts`：`PERMISSIONS`(8 点) / `ROLES`(3) / `ROLE_PERMISSIONS`（staff = productWrite, orderWrite, categoryWrite, seoWrite）/ `roleHasPermission` | ✅ |
| seed 与查询 | `packages/db/src/queries/authz.ts`：`seedRbac` `getPrincipalPermissions` `getPrincipalRoles` `assignRole` `revokeRole` `listAdminMembers` | ✅ 连库验证过 |
| 守卫工具 | `apps/admin/lib/auth.ts`：`readAdminSession()`（**会话+权限集单一读取点**，未登录返回 null 不跳转）/ `requireAdmin()`（= 前者 + 未登录跳 /signin）/ `requirePermission(perm)`（不足抛 `FORBIDDEN:<perm>`） | ✅ |
| 入口表单一真源 + 导航按权限过滤 | **`apps/admin/lib/nav.ts`**（`NAV_GROUPS` + `navItemVisible` + `dashboardCards`）——「入口 + 所需权限点」只住在这里；`layout.tsx`（异步软取会话 + `dynamic="force-dynamic"`）→ `AdminSideNav` 按分组过滤，**「概览」页的快捷卡片也由同一张表供给**（标 `card: true` 的项）（ERP 式左侧分栏，2026-10-22 重做） | ✅ **审查 L-1 已修**：原先概览页 `app/page.tsx` 自己抄了一份**无 perm** 的 8 卡片表，与导航口径不一致 → staff（`product/order/category/seo:write`）看得到「市场」「团队权限」，点进去撞 `requirePermission` 抛的 `FORBIDDEN` 错误页。现收敛到单表；**负向实测**：`super_admin` 8 张（与修复前一致，无视觉回归）、`staff` **6 张**（/markets 与 /team 不再画）、`customer` 0 张。回退风险由 `admin-guard.test.ts` 的「入口表单一真源」断言看住（实测塞一份硬编码清单进去会报错） |
| **覆盖矩阵** | 见 §4 | ✅ **已收口**（34/34 动作 + 13/13 页面） |

### 3.4 目录（商品/类目/品牌/属性/媒体/slug/译文）
| 能力 | 位置 | 状态 |
|---|---|---|
| 浏览列表单一真源 | `queries/product.ts` → `browseProducts`（active ⨝ 主变体 ⨝ 该市场 vmp ⨝ 译文 ⨝ current slug + 批量附首图）/ `getProductById`（**也筛 `status='active'`，审查 H-3**——PDP/评价页不再经直链渲染草稿/归档商品；后台预览走 `loadAdminProductDetail` 不受限）/ `getCategoryById` / `getBrandById` / `getCategorySubtreeIds`（BFS，**未用 ltree**） | ✅ |
| 站内搜索 | `queries/product.ts` → `searchProducts`：`productTranslations.searchVector`（generated tsvector）`@@ websearch_to_tsquery('english', $q)` + `ts_rank`；GIN `pt_search_gin`（§15.1‑5） | ✅ 参数绑定免注入；Typesense 未接（规模路径） |
| slug 单一真源 | `queries/slug.ts` → `slugify` / `getEntitySlug` / `setEntitySlug`（旧行降为历史 + 插新当前行 → 前台 `permanentRedirect` **308**，审查 M-1 与 PDP 同口径）/ `resolveSlug`（`current` \| `redirect`）/ `listCurrentSlugs`；同类型内占用冲突自动 `-2/-3` | ✅ PDP/类目/品牌/评论/CMS 五处走它（历史 slug 重定向统一 308） |
| 商品管理写侧 | `queries/catalogAdmin.ts` → `createProductWithVariant`（product+主变体+库存+slug+译文+发全市场算价事件）/ `setProductCatalog` / `setProductRichBody` / `upsertProductFromRow`（CSV/URL 用） | ✅ |
| 类目/品牌/属性 | `queries/category.ts` `brand.ts` `attributeAdmin.ts`（属性定义 CRUD + `setCategoryAttribute`/`removeCategoryAttribute`；值存 JSONB `attrs`） | ✅ 后台可用；属性模板引擎/facet 下发 ❌（Phase B） |
| 媒体 | `queries/media.ts` → `attachProductImage`（写 media_assets + product_images）/ `listProductImages` / `deleteProductImage`（回 r2Key 供上层删对象）/ `moveProductImage`；URL 拼装 `core/media.ts` → `mediaUrl(r2Key)` = `MEDIA_PUBLIC_BASE + key` | ✅ **审查 L-3 已修（2026-10-29）**：① 三个写函数全包进 `db.transaction` —— 旧写法两步写半途失败会在 `media_assets` 留下无人引用的孤儿行，**连生产库对照实测：旧码残留 1 行、新码 0 行**；② `position` 的「读 max 再 +1」是 check-then-act，对 products 行 `FOR UPDATE` 串行化（与 `setVariantOnHand` 同口径），商品不存在改报 `PRODUCT_NOT_FOUND`；③ `deleteProductImage` 改为「media 仍被别的商品引用时只解绑、**不返回 r2Key**」—— 旧写法直接删会撞 FK 23503 使这张图**永远解绑不掉**，而上层照 r2Key 删对象会删掉别人在用的图；④ 上层两个上传动作（`products/[id]/actions.ts`、`products/import/actions.ts`）登记失败时顺手 `MEDIA.delete(key)`，补上 R2 那一半泄漏（R2 不受事务管）。取证：`pnpm --filter @onestarry/db smoke:media`（A 半途失败零残留 / B 不重号 / C 行锁确实持有 / D 交换原子 + 共享 media 只解绑），全部在事务内跑并回滚。**已评估并否决「给 (product_id, position) 加唯一索引」**：① 现网实测重号 **0 组**（全表仅 2 行图片、孤儿 media 0 行）⇒ 不是当下敞着的坑；② `moveProductImage` 的交换在任何**非 deferrable** 唯一索引下都可能瞬时撞唯一（单条 CASE UPDATE 的行访问顺序不保证），真要加得改成 `DEFERRABLE INITIALLY DEFERRED`，而 drizzle 表达不了它 ⇒ 只能进 `drizzle/manual/` 手写 SQL，于是这条约束在声明层与快照里都看不见（新环境重建靠人记住重放 manual）；③ 重号的实际影响有界：`listProductImages` 次级排序按 `media_assets.created_at`，展示顺序仍确定，不会随机抖动 |
| 富文本 | 存 ProseMirror JSON（`productTranslations.richBody` / `contentTranslations.body`），渲染统一 `apps/web/components/RichBody.tsx` | ✅ 铁律"绝不存 HTML"成立 |

### 3.5 库存
| 能力 | 位置 | 状态 |
|---|---|---|
| 水位读写 | `queries/inventory.ts` → `getStock` / `setVariantOnHand`（后台改库存） | ✅ `setVariantOnHand` 整段置于事务内 + `SELECT ... FOR UPDATE`（审查 M-4）——否则并发同 SKU set 会各自从旧值算 delta、把 adjustment 流水重复计入（审计虚增） |
| 扣减 | `shipments.ts` 内 upsert `inventory.onHand -= qty` + 写 `stockMovements.sale` | ✅ 发货时才扣。**DB 符号 CHECK `sm_qty_sign`（迁移 0023，审查第三轮 schema 漂移）**：`quantity` 是对 on_hand 的带符号增量，符号须与 type 一致（sale/damage 负、receive/return 正、adjustment 非零），防“发货把扣库误写成 +”这类符号写反；不给 `on_hand_after` 加 `>=0`（`on_hand` 本身无此约束、超卖负快照合法）。⚠ drizzle 会把 `check(sql\`${t.quantity}\`)` 渲染成表限定名 `"stock_movements"."quantity"`，PG 的 CHECK 无 FROM 上下文→`42P01`；**CHECK 表达式必须写裸列名** `"quantity"` |
| **预留/超卖防护** | `queries/orders.ts` `createOrder`（事务内建单后原子 `UPDATE inventory SET reserved+=qty WHERE on_hand-reserved>=qty`，不足即抛 `NOT_SELLABLE:insufficient_stock` 回滚）+ `queries/inventory.ts` `releaseReservation`/`releaseExpiredReservations` | ✅ **审查 H-2**：`available=on_hand-reserved` 此前 reserved 从不递增→并发结账必超卖。现仅 `in_stock_only` 行占位（backorder/preorder/made_to_order 不占，不误伤无货下单）；快照存 `orders.reservation`，发货消耗、整笔退款释放、未付过期 cron 回收（`releaseReservation` 靠 `FOR UPDATE`+置 null 幂等，只放一次）。⚠ 占位与建单必须同事务（单条 CTE 里 `exists(ins_key)` 门控 reserve + 跨 CTE 计数对 Postgres 求值顺序敏感、会误伤有货单）→ 代价：结账多 BEGIN/COMMIT 两趟。**残余**：无 `inventory_reservations` 独立表/秒杀热行无 Redis Lua（架构 §6.2）；TTL 默认 60 分（`RESERVATION_TTL_MINUTES`） |

### 3.6 定价与可售性
| 能力 | 位置 | 状态 |
|---|---|---|
| 落地价纯函数 | `core/pricing.ts` → `computeLandedPrice({goodsValue, shipping, taxRate, dutyRate, pricingMode, dutyPresentation, thresholdCents, overThresholdPolicy})` → `{taxCents, dutyCents, displayedPriceCents, allInCents, blocked}` | ✅ 6 个单测覆盖阈值分支 |
| 物化缓存 | `queries/pricing.ts` → `recomputeVariantMarketPrice`（`inputsHash` 命中即跳过；list 价变则写 `priceHistory`，reason ∈ manual/promotion/duty_recalc/fx_recalc） | ✅ |
| 事件发射 | `emitPriceRecomputeForAllMarkets`（遍历全部 markets 发 `price.recompute`）+ `updateVariantBasePrice` | ✅ **但 payload 里 taxRate/dutyRate/shippingCents=0、fxRate=1**（D01） |
| 可售性 | `core/sellability.ts` → `computeSellability` + 单测 | ✅ 被 `createOrder` 调用（D02）；shipsTo 第 6 条暫写 true 未接 zones → M-11 |
| 运费 | `core/shipping.ts` → `computeShipping(rateCard, weightG, dimsCm?, goodsValueCents)` + `core/shippingProvider.ts` Fake | 🟡 函数与单测就绪，**结账未接线**（D03） |

### 3.7 订单 / 结账
| 能力 | 位置 | 状态 |
|---|---|---|
| 购物车 | `apps/web/lib/cart.ts`（httpOnly cookie `cart` = `{variantId: qty}`，7 天）+ `queries/cart.ts` `getCartLines`（按 DB 重新取价/库存） | ✅ 无 Redis、无 carts 表。读车经 `core/cartMap.sanitizeCartMap` 净化（整数 1..999、UUID key、行数上限）；**写侧 `addToCart`/`setQty` 先 `clampCartQty` 封顶再写（审查 H-2）**——否则输入 1000 会被读侧整条丢→商品静默消失；输入框带 `max`。**`getCartLines` 带出 `productStatus`（审查 M-7）**：车页/结账页把非 active/被禁行标红且拦住结账（不静默丢行），`checkoutAction` 将 `NOT_SELLABLE` 归为专用 `?error=unavailable`。**运费展示与落账已共用单点 `PLACEHOLDER_SHIPPING_CENTS`（审查 M-1，不会再漂移）**；展示不含税/关与落账口径的分叉属“接了真税率才爆”的潜伏问题，随 N2（真 Tax/Duty）一起用 `computeLandedPrice` 喂两侧，不现在造假税 | 
| 下单 | `queries/orders.ts` → `createOrder`（幂等占位 → 地址 → 批量取 vmp → 汇总 subtotal/tax/duty/shipping/discount → orders + order_items(snapshot) + order_lines → 发 `order.created`；**末了事务内原子占位 `reserved+=qty`（审查 H-2，不足回滚整单）**）；单号 `SO-<base36 时间>-<8 位 CSPRNG>`（`core/orderNumber`，旧 3 位存量仍可读） | ✅ 连库冒烟 + e2e；数量/行数/总额均有硬校验，库侧另有 CHECK 约束；预留见 §3.5。**审查 M3 已修（2026-10-29）**：`snapshot` 旧只存 `{currency,listPriceCents,allInCents}` 而读侧 `getOrderByNumber` 是 left join `product_translations` 取**当前**标题 ⇒ 运营改一次商品名就把所有历史单的确认页/后台详情/以后的发票邮件一起改掉（与 schema 注释承诺的“固化标题”相反，且与 EU 凭证口径冲突）。现在：写侧在同一条取价查询里顺带 join 译文（不多一次跨洋往返）并把 `title` 写进 snapshot；读侧 `coalesce(nullif(snapshot->>'title',''), pt.title)` —— **旧单没这个字段自动回退**，无需回填。实测：`smoke:create-order` 插一条“无 title 的旧形状行”专证回退分支仍活；旧代码跑同一用例精确红在 `snapshot.title undefined`（实测旧 shape 就三个金额字段）。⚠ **仍未固化**：注释里承诺的图片/选项值/税率不在本次范围（只把“名字”这条会被人改的补上）。**审查 L1 已修（2026-10-29）**：订单币种原来是**入参**（前台写死 `"USD"`）⇒「市场改价成 EUR 而订单头仍写 USD」无人发现，而 0 位小数币种下同一串数字是两种钱。现在 `CreateOrderInput` **删掉 `currency`**，币种取自给出这些金额的价格行（大写归一），一张单只允许一种币种，混币种抛 `CURRENCY_MIXED`。实测：`smoke:create-order` 新增 EUR 市场段证派生（下单不传币种 → `orders.currency=EUR`）+ 手工插一行“EUR 市场里的 USD 价格行”证混币种拒单且零悬挂单 |
| 结账入口 | `apps/web/app/checkout/{page,actions}.tsx`（读 cookie → `createOrder` → 清车 → 跳 `/pay/[orderNumber]?t=`） | 🟡 硬编码 market `us` / locale en / 运费 500（**币种已不再是入参**，由价格行派生，审查 L1）；字段已封顶+邮箱/国码校形，失败原因进 `console.error`（给用户仍是笼统提示）。**审查 C-1（Critical）已修**：`redirect()` 靠抛 `NEXT_REDIRECT` 生效，旧写法把它和 `writeCart` 写在 `try` 内 → 被通用 `catch` 当“下单失败”吞掉→每笔成功单也被踢回 `?error=failed`（订单已入库+车已清+用户永远进不了 `/pay/*`）；现 `try` 只留 `createOrder`，清车+跳转移出 `try`（清车失败单独 catch 记日志不挡跳转）。另：`/account/orders`（force-dynamic + `redirect("/signin")`）删掉 `loading.tsx`（审查 H-1，铁律 5：骨架会把未登录 `redirect` 变 200 软响应；部署后 `curl -I` 应见 307） |
| 订单确认页 | `apps/web/app/order/[orderNumber]/page.tsx` | ✅ 登录态判归属（不同归属 notFound）+ 非归属掩码邮箱 + `robots index:false`；`robots.ts` 已屏蔽 `/order`。**本路由故意不配 loading.tsx**：`force-dynamic` + loading.tsx 会先冲流式外壳把状态行定成 200，之后 `notFound()` 只能塞 404 内容进去 → 线上实测就是「404 页面 + HTTP 200」的软 404（ISR 页如 PDP 不受影响，实测给的是真 404）。仍无游客 magic link（下一行） |
| 订单查询 | `queries/orders.ts` `getOrderByNumber`；`adminOrders.ts` `listRecentOrders`/`listOrdersByCustomer`/`getOrderDetail` | ✅ |
| 游客查单 magic link / 购物车合并认领 | — | ❌ 未实现 |

### 3.8 支付与账本
| 能力 | 位置 | 状态 |
|---|---|---|
| Provider 接缝 | `core/payments.ts` → `PaymentProvider`(createCheckout/verifyWebhook/refund) + `FakePaymentProvider`；事件归一到 `PaymentOutcome = paid\|revoked\|refunded\|ignored`（单靠一个 `succeeded` 布尔判不出“钱被撤回”）+ `captureRef`（退款事件的 resource 是退款体，靠它回溯原收款）+ `currency`（与金额**成对**上交，审查 L1；`mapPaypalWebhookEvent` 大写归一，体里没金额就为 null —— 上层当“没给”而不是“对得上”） | ✅ |
| PayPal 纯逻辑 | `core/paypal.ts`：金额字符串（0 位小数币种）、SDK URL、建单体、capture/refs 解析、`cert_url` 判域、验签体、事件分类 `paypalEventOutcome`、沙箱闸 `paypalSandboxBlocked` | ✅ 14+8 单测钉住（事件名逐字照官方 event-names，错一个字母就静默归 ignored） |
| PayPal IO | `apps/web/lib/paypal.ts`：OAuth（per-isolate token 缓存 + 401 重试一次）/ create / capture / show / webhook 验签；不引官方 SDK（Workers 上 fetch 四端点更好审） | 🟡 代码就位、**未跑过真 API**（待凭据） |
| 支付页与路由 | `/pay/[orderNumber]`（凭证页；按钮凭证取 `?t=`，登录本人从「我的订单」进来无 `?t=` 时回落 `order.publicToken`，与 `/api/paypal/orders` 同口径认会话——审查 M3 修“本人点去支付是死路”）+ `PayPalPayButton` + `POST /api/paypal/orders`（金额只取库、`PayPal-Request-Id` 幂等、复用存过的 `paypal_order_id`）+ `POST /api/paypal/capture`（**三道闸**：必须是我们为这张单建过的那张 / `custom_id` 等于我方单号 / 金额等于应付 **且币种一致**（审查 L1：0 位小数币种下同样的数字是两种钱；PayPal 未给出币种就按不符拒，fail-closed）） | ✅ typecheck+冒烟；支付动作在服务端发生，不信前端递的 orderID。订单访问判定 `lib/orderAccess.ts` 的凭证比对改用同仓常量时间 `secretsMatch`（审查 L-6，替掉明文 `===`；128-bit token 本不可时序爆破，此为口径统一）；**`/pay/*` 与 `/order/*` 页去掉对已解码路由段的二次 `decodeURIComponent`（审查 L-2：非法 % 序列会抛 URIError→500，`resolveOrderAccess` 内部已用 `^[A-Za-z0-9_-]+$` 校验，含任何 % 直接 404）** |
| webhook 接收 | `apps/web/app/api/webhooks/[provider]/route.ts`：**fail-closed** —— 默认无 provider 直接 501；`paypal` 且凭据齐 → 真验签（五条头 + 订阅 id + 整个 `webhook_event`）；`FAKE_PAYMENTS_ENABLED=1` **且走专属 slug `/webhooks/fake`** 才接受假回调（审查 L-5：Fake 不验签，不能冒充真实 provider 路径；旧写法 `FAKE=1` 时任意 name 包括未配凭据的 paypal 都会收未签名假回调）；**事件状态由“钱是否真的落了账”决定（审查 H-1）**：paid 未定到单 → `failed`+`error='ORDER_UNRESOLVED'`（不再误标 processed），无法关联原收款 → `ignored`+`error`（接通了 `webhook_events.error` 写通道）；体上限 256KB；`(provider, provider_event_id)` 幂等 | ✅ 幂等已验证；真回调待凭据配好。**审查 M-8 已修**（事件提交次序/错误分类）：`catch` 现把错误分两类——**不可恢复**（金额≠应付 `PAYMENT_AMOUNT_MISMATCH`、借贷不平 `LEDGER_IMBALANCE`、`PAYMENT_INSERT_FAILED`/`LEDGER_TXN_FAILED`、`MARKET_NOT_FOUND`、`PAYMENT_AMBIGUOUS`、`REVERSAL_AMOUNT_OVER`、**`PAYMENT_CURRENCY_MISMATCH`/`REVERSAL_CURRENCY_MISMATCH`（审查 L1：PSP 报的币种与订单/原收款不符，重投一万次也不会变）**、**`ORDER_CANCELLED`（审查 L2：单已被未付过期回收、预留已释放，重投也不会变成可履约）**）→ **durably 写一行 `webhook_events`(status=failed+error，走 wh_status_idx)** 后回 **200 停投**（旧写法一律 500→事务连同 event 行回滚→运维看不到且 PSP 无谓重投 3 天）；**可恢复**（`PAYMENT_NOT_FOUND` 时序竞态、`ORDER_NOT_FOUND`、及**任何未知/基建错误**）保持 500 重投（allowlist 而非 blocklist，**未知默认重投、绝不安抚未成功处理的事件**）。happy-path 单事务结构**未动**（保住回滚+重投语义与 H-1 的 ORDER_UNRESOLVED 处理）。**审查 L5 已修**：换 event_id 的重复回调旧写法只回 200，但上面的事务已连同 `webhook_events` 那次 INSERT 一起回滚 ⇒「PSP 拿另一个 event_id 告诉过我们一次」在库里**零留痕**（只能去挖日志）；现补一条 durably 提交的收据（status=processed + error=`DUPLICATE_REPLAY:...`，`onConflictDoNothing` 让同一 event_id 重投仍幂等）。验证：**前提由 `smoke:payments-posting` 连库实测**（错金额抛 AMOUNT_MISMATCH 且零 payment 写入）+ 分类真值表（对实际抛出串含 `:明细` 后缀跑 startsWith）+ typecheck；route 需 Workers ctx，**未做 live-POST 集成测** |
| 支付段落账 | `queries/payments.ts` → `recordPaymentSucceeded`：建 payments + `ledger_transactions` + 借 psp_clearing / 贷 customer_deposits+tax_payable+duty_collected，**组内借贷 SUM≠0 整笔回滚**；同单重复落账抛 `PAYMENT_ALREADY_RECORDED`（webhook 当幂等重放回 200）、金额≠应付抛 `PAYMENT_AMOUNT_MISMATCH`；辖区由 market→legalEntity 带出；`nextDocumentNumber`（行锁 upsert 自增）+ 建 invoices；订单转 paid；发 `payment.succeeded` | ✅ 冒烟通过。MVP 假设本位币=订单币种（fxRate "1"）。**并发/换 event_id 重放孪生于发货 C-1（审查 P1）**：取单 `SELECT ... FOR UPDATE` + 转 paid 带 `paymentStatus <> 'paid'` 条件更新与 `.returning()` 命中判定 + DB 部分唯一索引 `payments(order_id) WHERE status='succeeded'`（`pay_order_succeeded_uq`，迁移 0020）三层兜底；`smoke:payments-posting` 实测二次落账抛 `PAYMENT_ALREADY_RECORDED`、第二笔 succeeded 被 23505 拒。**审查 L2 已修（2026-10-29）**：`order.status === "cancelled"` 时抛 `ORDER_CANCELLED:<单号>` —— 交互路径有 `orderAccess.payable` 拦着，但 **webhook 路径不经过那道闸**，静默置 paid 就是超卖一件 + 一张“已付的取消单”（钱真到了、货已卖给别人，只能走人工退款）。**审查 L1 已修**：新增可选入参 `currency`（capture 与 webhook 两个入口都带），与订单币种不符抛 `PAYMENT_CURRENCY_MISMATCH`（大写归一比较；空串也当不符，fail-closed）。实测：`smoke:reservation` 4b 段（cancelled 单落账被拒 + paymentStatus 仍 unpaid + 零 payment 行）、`smoke:payments-posting`（JPY 被拒且零写入；小写 `usd` 放行证大小写不误伤真钱）；新增的三道守卫（cancelled 不落账 / 落账币种 / 冲账币种）都在**旧代码上跑同一用例确认变红**（“没报错——守卫失效”） |
| **支付反向落账** | `recordPaymentReversal`：钱被收回（DENIED/REVERSED）或退掉（REFUNDED）时的**红冲** —— 只追加分录不改原分录（`ledger_entries` 已 REVOKE UPDATE/DELETE）；金额走 `core/payments.splitReversal` 按原占比摊且**和恒等于本次额**；出 `CN-` 独立序列的红字凭证；refunded 写 `refunds` 台账行、revoked **不写**（不是退款，写进去污染报表）；`payment_status` 走 unpaid/refunded/partially_refunded 但**不回退 `orders.status`**（发货进度不由支付事件抹掉）；重复退款号→`PAYMENT_ALREADY_REVERSED`（去重必须排在金额校验前，否则重放被报成“超退”→ PayPal 永远重投）；并发双记由 `refunds(payment_id, provider_ref)` **部分唯一索引（`refund_payment_ref_uq`，迁移 0018）**在数据库层兜底（23505）；**并发部分退款超额（审查 H-1）**：取 `payments` 行时 `SELECT ... FOR UPDATE`，使 `sum(refunds)`→`remaining`→`amount > remaining` 判断全在锁内串行化（`refund_payment_ref_uq` 只挡同一 provider_ref 重放，不同 ref 的双退靠此锁拦截）。**币种闸（审查 L1）**：`input.currency` 与原 `payments.currency` 不符抛 `REVERSAL_CURRENCY_MISMATCH`，位置在退款号去重**之后**、金额判定之前（守住“先把重放消化成 200、再报真错”那条顺序规则） | ✅ 冒烟 `smoke:payments-reversal`（分摊/借贷平/连号/不双计）+ `smoke:refund-dedup`（重复 ref 被 23505 拒、不同 ref 放行，审查 M5）实测连库 |
| 沙箱凭据闸 | `paypalWriteBlocked`：`PAYPAL_ENV=sandbox` 时未经 `PAYPAL_ALLOW_SANDBOX=1` 不得建单/扣款/落账（本地 `.dev.vars` 默认给，线上默认无） | ✅ 单测钉住 |
| 发票号唯一约束 | `invoices`/`credit_notes` 的唯一索引范围 = **(法人, 号)** 而不是全表（旧定义全表唯一，多法人必撞 `US-00000001`）；迁移 0017 | ✅ 已应用 |
| 发货段确认 | `queries/shipments.ts` → `recordShipment`：借 customer_deposits / 贷 revenue+shipping_revenue；借 cogs / 贷 inventory_asset（**COGS 用 `variant.costCents` 近似**，移动平均未做）+ 扣 onHand + sale 流水 + `fulfilled` + 发 `order.shipped` | ✅ 冒烟通过。**并发双击/重放防护（审查 C-1）**：事内 `SELECT ... FOR UPDATE` 锁单行 + `update orders ... WHERE fulfillmentStatus <> 'fulfilled'` 条件更新带 `.returning()` 命中判定 + DB 部分唯一索引 `shipments(order_id) WHERE status <> 'returned'`（`ship_order_uq`，迁移 0019）三层兜底；`smoke:shipment` 实测二次发货抛 `ALREADY_FULFILLED` 且第二张未退回运单被 23505 拒。**COGS 取数（审查 M-3）**：`inArray` 批量取成本（消 N+1），区分 NULL（未设参考成本）与 0（真免费）——**NULL 抛 `COGS_COST_UNKNOWN`**，不再 `?? 0` 静默记 0 后连同 inventory_asset 被 `filter(amount!==0)` 整对吞掉致利润虚增无痕；`markShippedAction` 失败原因进 `console.error`（不再黑盒）|
| 科目种子 | `queries/ledger.ts` → `STANDARD_LEDGER_ACCOUNTS` / `seedLedgerAccounts` / `requireAccountId` | ✅ |
| 主动退款 / 争议 / payouts / 发票 PDF / 关税对账 | 表在；`refunds` 已可由 webhook 事件填充，但**商户侧发起退款的 API 与后台动作未做**（`PaypalPaymentProvider.refund()` 显式抛 `PAYPAL_REFUND_NOT_IMPLEMENTED`）；`disputes`/`payouts` 无写入方 | ❌ |

#### 输入与输出边界（2026-10-23 代码审查后新增）

这一组模块的存在理由只有一个：**外部可改的东西不能直接参与钱与 HTML**。全部是纯函数（core）或单一入口 helper（admin），所以每条规则都能单测。

| 位置 | 管什么 | 谁在用 |
|---|---|---|
| `core/orderNumber.ts` | 订单号生成（CSPRNG 8 位 base36，rejection sampling 去偏差；无 `crypto` 时**抛错而不退化到 `Math.random`**）+ 形状校验 | `queries/orders.ts`、`app/order/[orderNumber]/page.tsx` |
| `core/cartMap.ts` | 购物车 cookie 净化：整数 1..999、UUID key、行数上限、丢弃计数 | `apps/web/lib/cart.ts` |
| `core/safeOutput.ts` | `jsonLdScript`（转义 `< > &` 与 U+2028/29，`JSON.stringify` 不转义 `<` → 商品标题能跳出 script 上下文）、`safeHref`（协议白名单）、`acceptedImageType`（图片 MIME 白名单，**SVG 拒**） | 4 处 JSON-LD、`RichBody`、后台两处上传 + 导入拓图 |
| `core/fetchGuard.ts` | 服务端代抓 URL 的准入（协议/端口/凭据/环回与私网与云元数据字面量）+ 字节与重定向上限常量 | `admin/lib/safeFetch.ts` |
| `admin/lib/safeFetch.ts` | 逐跳重判（`redirect:"manual"`，否则 302 能绕进内网）+ 15s 超时 + **流式截断** | URL 抓品与拓图 |
| `admin/lib/ids.ts` | 拼进 R2 key / SQL 条件前的 UUID 形状校验 | 两处上传 + 拓图 |
| `drizzle/0015_order_checks.sql` | 库侧底线：`oi_quantity_range`、`order_total_nonneg`、`order_discount_nonneg`、`payment_amount_nonneg` | **已应用至 Neon**（存量违规 0，并实证负数量插入被拒） |

### 3.9 outbox / relay / cron / 保留
| 能力 | 位置 | 状态 |
|---|---|---|
| 事件表读写 | `queries/outbox.ts` → `emitEvent` / `fetchPendingEvents`（**含 pending + 未超阈 failed**，审查 H1）/ `markDispatched` / `markFailed`（attempts+1，`case when >= OUTBOX_MAX_ATTEMPTS 则 dead 否则 failed`）/ `markDead` | ✅ |
| relay 引擎 | `packages/jobs/src/relay.ts` → `runRelayBatch(db, handlers, {limit})`：按 `eventType` 查注册表；**未注册 handler 的未知类型 → `markDead`（不 ack）**，使 dead 计数在 `/health`与运维面板显形（审查 H1）。`handlers.ts` 把 order.*/payment.* 显式注册为 no-op（已知无下游、诚实 ack），dead 通道专留给真正未知类型 | ✅。**审查 L4 评估＝当前不发作、但已设硬前置（2026-10-29）**：`fetchPendingEvents` 是普通 SELECT（无认领、无锁），批末才 `markDispatched` ⇒ Cron 与写时 `waitUntil` 自派发重叠时同一批可被两个 runner 各跑一遍。今天无害：唯一真 handler `price.recompute` 靠 `inputsHash` 短路、其余是 no-op。**前置：接任何非幂等 handler（邮件 N9、对外 webhook）之前必须先加原子认领**，否则就是重复发信。两条候选设计与代价（都不许半途做）：① 新增枚举值 `processing` + `UPDATE … WHERE status IN ('pending','failed') … RETURNING` 认领 —— 要 `ALTER TYPE ADD VALUE` 迁移，且 `/health` 得新增“卡在 processing”这一维（runner 被杀就得有回收口径）；② 整批放进一个事务 + `SELECT … FOR UPDATE SKIP LOCKED` + 每个 handler 一个 savepoint —— 不动 schema，但 handler 执行期间长事务持锁、且 handler 的 SQL 报错会污染整批（要靠 savepoint 隔离）。⚠ 只把 `.for("update", { skipLocked: true })` 加在 `fetchPendingEvents` 上**无效**：不在事务里，语句一结束锁就放了 |
| handler 注册表 | `packages/jobs/src/handlers.ts` → 真实处理只有 `price.recompute` 一条；`order.created`/`order.shipped`/`payment.succeeded`/`payment.refunded`/`payment.revoked` 显式注册为 **no-op**（已知无下游、有意确认；接上邮件/索引时换成真实现即可） | 🟡 |
| Cron Worker | `apps/jobs/index.ts`：`scheduled` 每分钟跑 relay（`RELAY_BATCH_LIMIT` 默认 500）；`event.cron === "20 4 * * *"` 分流跑 `runDataRetention`；`fetch /health` 回 `getOutboxHealth` 的 pending/failed/dead（`ok = dead===0`，审查 H1） | ✅ 已部署。**审查 L-4 评估＝有意保留（非缺陷）：`/health` 回 outbox 计数是 H1 决策（部署核验 + 单报 pending 会漏掉 failed/dead 断链），报的是无 PII/凭据的低敏运维计数，与公开 web `/api/health`（同报配置布尔 + ISR verdict）同口径，不加鉴权（会打断部署核验的 ping）** |
| 写时自派发 | `apps/admin/app/products/[id]/actions.ts` + `products/import/actions.ts` 提交后 `ctx.waitUntil(runRelayBatch(...))` | ✅ 秒级生效，Cron 兜底 |
| 数据保留 | `queries/retention.ts` → `runDataRetention`（idempotency_keys 过期 / outbox dispatched>90d / webhook>90d；不碰账本/库存/会话） | ✅ **已改有界分批（2026-10-29，0016 登记的延迟炸弹）**：每批 `WHERE id IN (SELECT ... LIMIT 5000)`，每张表每次最多 20 批，抵顶则 `RetentionResult.capped=true`（jobs 日志会带出来）——因为 `app_rw` 现在吃 30s `statement_timeout`，无界删一旦积压就会**整条被杀**而不是“慢一点”。`smoke:retention` 连库验三件事：跨批计数不重复 / 内层子查询真带 LIMIT / 窗口口径没因改写变宽（5001 行样本，全程事务内回滚）。**审查 L6 修正（2026-10-29）**：webhook 清理原本不看 status，90 天后连“证据行”（`status='failed'` 或 `error` 非空 —— `ORDER_UNRESOLVED` / `PAYMENT_CURRENCY_MISMATCH` / `ORDER_CANCELLED` / `DUPLICATE_REPLAY` / `UNASSOCIATED`）一起删，而这些分支的业务事务是回滚的 ⇒ event 行是“钱到了但没落账”在库里唯一的留痕。现：过窗只删 `status <> 'failed' AND error IS NULL`，证据行保留（增长由 `(provider, provider_event_id)` 唯一约束兜住 ⇒ 每个 PSP 事件最多一行），并新增 `RetentionResult.webhookEvidenceHeld`（每日 jobs 日志带出，豁免不许悄悄长成大表）。谓词写正向而不取反：`not(or(...))` 在 `error IS NULL` 的行上整体求值为 NULL ⇒ 会静默一行都不删。`smoke:retention` 加第④条断言（3 条证据行全活 + 无 error 的 processed 照旧清光；只验一半会放过“整表不删”这种伪装修复）；负向对照：`retention.ts` 退回 HEAD 跑同一条 smoke ⇒ `实际 5004 !== 5001` 变红。报告里“仍是无界 DELETE”那半句**已过时**（有界分批早前就收口了）。只读探针实测（2026-10-29）：`webhook_events` 共 1 行（processed、无 error）、过窗 0 行；`transactional_outbox` dispatched 9 行 ⇒ 本项是前瞻性修正，无历史包袱要回填 |

### 3.10 SEO 前台
| 能力 | 位置 | 状态 |
|---|---|---|
| seo_meta 稀疏覆盖 | `queries/seo.ts`（回退链 `(locale,market)` → `(locale, NULL)`；**全空即删行**）+ `apps/web/lib/seo.ts` `applySeoMeta` | ✅ 审查 M-10：旧可空列唯一索引对 NULL 不约束 → 并发双插双行、`getSeoMeta limit(1)` 随机取（改了没生效）。现改 `COALESCE(market_id, 零值uuid)` 表达式唯一索引（迁移 0021）+ upsert 靠 catch 23505 转更新；`smoke:seo` 实测两次 upsert 收敛 1 行、直插第二行被拒 |
| JSON-LD（4 处） | 首页 `app/page.tsx`（`WebSite` + `Organization`）· PDP `products/[slug]`（`Product` + `Offer`，availability 按库存）· 类目页 / 品牌页（`BreadcrumbList`）。**`layout.tsx` 不含 JSON-LD**；PDP 自身无面包屑结构化数据 | ✅ 类目/品牌有面包屑；PDP 面包屑 schema ❌ |
| sitemap | `apps/web/app/sitemap.ts`（Next 原生、`force-dynamic`：首页 + /products + 全 active PDP + 类目 + 品牌） | 🟡 **不含 /blog 与 page/landing 内容页**（CMS 上线后未回补）；未做 R2 分片（文档 §10.1 规模路径）。**审查 L-7（动态 sitemap 每次进库）→ 评估后不改**：2026-10-29 实测生产 `/sitemap.xml` **1.27s / 1.40s、HTTP 200**（同机对照：`/api/health` 首跳 3.09s 是冷 isolate+TLS，不是库），3 条查询串行但不服务用户 ⇒ 无用户可感代价；改 ISR 需先把取数改走 `apps/web/lib/db.ts` 的 `getDb()` 回退（现直用 `getCloudflareContext()`，静态化后**构建期预渲染会报错**），且缓存窗口得进 `core/site-status.ts` 单一真源 —— 收益不值这些改动，规模路径仍按 §10.1（cron 预生成 → R2 分片 + 动态 index） |
| robots | `apps/web/app/robots.ts`（disallow `/account` `/cart` `/checkout` `/api` + sitemap 挂载） | ✅ |
| 面包屑/404/错误边界 | `not-found.tsx` / `error.tsx` / `global-error.tsx` | ✅ |
| 安全响应头 | `scripts/security-headers.mjs`（单一真源）供 web/admin 共用：nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / HSTS（`images.unoptimized`，**CSP 未加**需 nonce）。web `SAMEORIGIN`；**admin 取 `DENY`（审查 H-2，此前 admin 零头→/signin 可被任意站点 iframe 点击劫持、无 HSTS）** | ✅ |
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
| 查询 | `queries/reviews.ts`：`listApprovedReviews`（平均+计数+脱敏 author）/`createReview`（**verifiedPurchase = 该客户是否有含此商品的 paid/completed 订单**；rating 越界拒；**productId 夹 UUID 形状，畸形→`{error:INVALID_PRODUCT_ID}`（审查 L-3：否则非 UUID 落 uuid 列撞 PG 22P02→500）**）/`listReviewsForModeration`/`setReviewStatus` | ✅ createReview 返回 `{id}|{error}`；前台 `submitReviewAction` 不再丢弃错误（审查 M-6）——出错退回评价页带 `?error=` 并显一行提示（当前表单 rating 恒 1–5、此路几乎不触发，属防御性收口） |
| 前台 | `/review/[slug]`（page+actions，登录用户提交 → pending） | ✅ **审查 M2 已修（2026-10-29）：路由从 `/products/[slug]/review` 搬出**。旧位置的两个祖先段各有一个 `loading.tsx`（PDP 骨架），而 `loading.tsx` 就是流式边界：Next 先冲骨架、状态行当时已定成 200，页里那句 `redirect("/signin")` 只能塞进 RSC payload 由浏览器执行 ⇒ 线上实测未登录拿到的是「200 + 骨架」（无 JS 客户端/爬虫/HEAD 探活看见的就不是“要登录”）。选择搬页而不是删骨架：PDP 骨架是转化率所需。**同批新增漂移守卫 `core/streaming-boundary.test.ts`**（force-dynamic 且页内直接写 `redirect()`/`notFound()` 的页，祖先段不得有 `loading.tsx`；含“合成用例必须抓出边界”的反空转断言）：旧树位置实测变红、搬迁后转绿。判据取“且会跳转”而非平铺禁骨架，理由写在测试头注（`/cart`、`/checkout` 带骨架但不跳转，删了就是拿转化率换一个今天不发作的风险；有人往这两页加跳转时守卫会立即变红）。另：`/review` 已加进 `robots.ts` 的 disallow（与 `/account`、`/checkout` 同口径） |
| 后台 | `/reviews` 审核页（`requirePermission(productWrite)`） | ✅ |
| 聚合评分物化到商品 / 投票 / 问答 / 反刷 | — | ❌ 未做 |

### 3.14 导入（CSV + URL 抓品）
| 项 | 位置 | 状态 |
|---|---|---|
| CSV | `core/csv.ts` `parseCsv`/`csvToObjects` → `apps/admin/app/products/import/{page,ImportForm,actions}.ts`（按 SKU upsert、`imageUrl` 自动下载转存 R2、行数上限、末尾 `runRelayBatch` 重算全包价） | ✅ |
| URL 抓品 provider | `apps/admin/lib/importProviders.ts`：`detectSource`（taobao/tmall/1688/alibaba → `taobao`；`*.myshopify.com` → `shopify`；其余 `generic`）+ `fetchProductFromUrl`（Shopify `/product.json`、JSON-LD `schema.org/Product`、OpenGraph 三级解析）→ `ProductImportDraft`；**淘宝/1688 返回 `needsProvider`**（反爬+登录墙，留专用 API 插槽）+ `enrichWithLlm` 插槽 | ✅ 抓自身 PDP 验证：标题/价格/图/SKU 全对。**审查 L-4 已修（2026-10-29）**：解析外部 JSON 的 3 处 `any` 全换成 `unknown` + 两个收窄助手 `obj()`/`text()`（本仓代码里的 `any` 现为零，`paypal.test.ts` 里最后一处也已转 `unknown`）。不是风格问题而是 type-lie：旧 `(i: any) => i?.src` 实测把 `{src:123}` 的 **数字放进声明为 `string[]` 的 images** 喂给上层当 URL 拉；旧 `String(n.name)` 还会把对象拼成 `"[object Object]"` **当商品名继续导入**（真建出空标题商品）。现在：非文本字段一律 null，无可用标题的 Product 节点直接判为解析失败。取证：一次性探针跑畸形体/正常体/旧写法对照四组（探针已删，长期保证由 tsc 收窄承担 —— 想写回 `any` 就编译不过） |
| 落地 | `importFromUrlAction`（`requirePermission(productWrite)`）→ 建 draft 草稿 → 抓图转存 R2 → 返回 productId 跳编辑页人工审核 | ✅ |
| 自动分类 | `categoryHint` 已抓但**未挂到我们的 categories** | ⏳ |

### 3.15 对外集成 API（步骤 14）
| 项 | 位置 | 状态 |
|---|---|---|
| 访问校验 | `apps/web/app/integration/_lib/access.ts` → `checkAccess`：**两道独立闸**——① Access 认证头存在（缺→401）；② `X-Integration-Key` 与 secret `INTEGRATION_SECRET` 常量时间相等（不匹配→401；密钥未配→503，写接口亦然） | ✅ **代码侧 fail-closed**（审查 C1）：不再仅凭头存在放行；JWKS 严格验签为可选加强（N13） |
| 读 | `GET /integration/demand`（`queries/integration.ts` `getDemandFeed`：已付 + 未发/部分发订单，按 variant 聚合 sku/hsCode/countryOfOrigin/quantity，**无 PII**；**入口夹 `sinceDays` 为整数 1..365（审查 L-1：旧 `Number(x)||30` 只挡 NaN，-1→未来截点恒空、1e9/Infinity→无时间过滤全表扫都穿过）**）；`GET /integration/inventory`（`getInventoryLevels`，`coalesce(available,0)`） | ✅ |
| 写 | `POST /integration/stock/receive` → `receiveStock`：`on_hand = on_hand + net` **原子增量**+RETURNING取真值（审查 M1）+ `stockMovements.receive`（带 unitCostCents/currency/supplierRef/externalPoRef 到 note）+ damaged 另写 `damage` 流水；`Idempotency-Key` 与库存写入**同一事务**、`onConflictDoNothing().returning()` 作并发闸（审查 H3）；variantId UUID 校验、`0<=qtyDamaged<=qtyReceived` | ✅ |
| 账本分录（借 inventory_asset / 贷 external_ap_clearing） | `receiveStock` 内 TODO(§13) | ⛔ |
| OpenAPI + zod 契约进 `packages/shared` | — | ❌ |
| "销售速度"派生指标（`daily_sales_stats` rollup） | — | ❌ 表都没建 |

### 3.16 后台页面清单（19 页 · 守卫已全部收口）
| 路由 | 页面守卫 | 动作守卫 |
|---|---|---|
| `/`（概览） | `requireAdmin`（任意已登录后台账号，有意保留） | — |
| `/products` `/products/[id]` `/products/new` `/products/import` | `requirePermission(productWrite)` | 13 动作：`[id]` 10（其中 `saveSeoMetaAction` = `seoWrite`）+ `new` 1 + import 2 = `productWrite` |
| `/orders` `/orders/[id]` | `requirePermission(orderWrite)` | `markShippedAction` = `orderWrite` |
| `/categories` `/categories/[id]/attributes` `/brands` | `requirePermission(categoryWrite)` | 6 动作 = `categoryWrite` |
| `/attributes` | `requirePermission(configWrite)`（**staff 连页面都进不去**） | 3 动作 = `configWrite` |
| `/legal` | `requirePermission(seoWrite)`；**已加进左侧导航「内容与合规」组** | `saveLegalDocAction` = `seoWrite` |
| `/content` `/content/[id]` | `requirePermission(seoWrite)` | 5 动作 = `seoWrite` |
| `/reviews` | `requirePermission(productWrite)` | 1 动作 = `productWrite` |
| `/markets` | `requirePermission(marketWrite)`（staff 进不去，修正以前"能看不能提交"的不一致） | `createMarketAction` = `marketWrite` |
| `/team` | `requirePermission(roleManage)` | 3 动作 = `roleManage` |
| `/status`（站点状态，2026-10-22 新增） | `requirePermission(configWrite)`（只读页，无动作） | — |
> 导航已换成 ERP 式左侧分栏 `components/AdminSideNav.tsx`（分组 + 可折叠存 localStorage + 移动端抽屉），**一律 `prefetch={false}`**（后台是 force-dynamic，预取会把 11 个入口全真渲染一遍，实测一次加载打出 36–45 个请求）。它按传入权限集过滤入口；**隐藏只是体验，硬强制在页面/动作的 `requirePermission`**（两者已逐项对应）。⚠ 也正因为 layout 只**软取会话**（`readAdminSession()` 不跳转），**layout 不构成兜底**——“新增一页忘写守卫”会变成公网可直接读到后台数据、而动作仍拒的**静默泄露**；此不变量已由 `packages/core/src/admin-guard.test.ts` 做成漂移护栏（审查 L-8，含“为何不用 middleware”的否决理由）。

> **审查 L3 已修（2026-10-29）：预取那道闸现在盖到正文**。上面那条“一律 `prefetch={false}`”当时只落在侧栏与列表页，
> 正文里漏了 **11 处裸 `<Link>`**：八个“← 返回上一级”入口（类目属性 / 内容编辑 / 法律 /
> 订单详情 / 商品详情 / 导入 / 新建 / 站点状态）、后台概览卡片、评论审核 tab，以及 `not-found` 的“回到概览”按钮
> —— 它们一进视口就把目标页**真渲染一遍**（查会话 + 查权限 + 查数据），
> 而这正是上面实测 36–45 个请求的那场风暴，只是规模小些。
> 处理：10 处改用 `components/PrefetchLink`（悬停满 150ms 才取、只取鼠标停住那一个，顺带把 2.4–3.4s 的点击等待
> 挪进那几百毫秒）；`app/not-found.tsx` 保留裸 `<Link>` 但补上 `prefetch={false}`，并在文件头写明为何不拉客户端边界。
> 整条不变量由新守卫 `packages/core/src/admin-prefetch.test.ts` 钉住（扫 `apps/admin` 全部源文件，每个带 href 的
> `<Link>` 必须显式写 prefetch）；它含两条反空转用例：“至少扫到足够多文件/链接”与“**标签必须整段取到**”
> —— 属性里的箭头函数 `onClick={() => …}` 也带 `>`，简单“撞到第一个 > 就停”会把标签截成半句、让检查变成假绿。

### 3.17 前台页面清单
`/`（首页 Hero/分类入口/精选/信任条）· `/products` `/products/[slug]` · `/review/[slug]`（发表评价，force-dynamic；2026-10-29 审查 M2 从 `/products/[slug]/review` 搬出，理由见 §3.13）· `/search` · `/categories` `/categories/[slug]` · `/brands` `/brands/[slug]` · `/blog` `/blog/[slug]` · `/[slug]`（page/landing）· `/cart` · `/checkout` · `/order/[orderNumber]` · `/pay/[orderNumber]`（带访问凭证的支付页）· `/account/orders` · `/signin` · `/legal/[type]`（terms/privacy/returns/withdrawal）· `/api/{health,auth/[...all],webhooks/[provider],internal/invalidate}` · `/api/paypal/{orders,capture}` · `/integration/*`

> 逐路由的**缓存窗口/渲染策略/失效方式**不再写在这里 —— 单一真源是 `packages/core/src/site-status.ts`，后台 `/status` 页与漂移守卫单测共用它。

> **金额展示的单一真源是 `packages/core/src/money.ts` 的 `formatMoney`（审查 L7 已修，2026-10-29）**。
> 原来 `new Intl.NumberFormat("en-US", { style: "currency", … })` 在 **9 个页面各抄一份逐字相同**的实现
> （7 个 web：PDP/支付页/确认页/购物车页/购物车行/结账页/我的订单；2 个 admin：订单列表/订单详情），
> 另有 `apps/web/lib/format.ts` 只给 `ProductCard` 用 —— 同一条口径写十一遍，下次要改（本地化/小数位/取整）
> 必然只改到一份，剩下的会安静地显示旧格式且不报错。现在十一处全改指 core；`lib/format.ts` 已删。
> 顺手补了一件旧副本没做的事：**非法币种码不再把页面打成 500** —— `markets.currency` 是无约束 text，
> 实测 `XY`/`US Dollars`/`""` 直接让 `Intl` 抛 RangeError（`undefined` 抛 TypeError），现在退成「两位小数 + 原始码」。
> 守卫：`money.test.ts` 钉住排版口径（含“原生 Intl 必须抛”这条对照前提，否则退路分支就是在测空气），
> 并扫 `apps/*` 禁止再出现自写的 `style: "currency"`（反空转：先断言至少扫到 30 个文件；
> 实测插入一个临时副本时守卫立即变红、删掉后转绿）。
> ⚠ **已知分叉、本次故意不动**：0 位小数币种（JPY/KRW/VND）本站仍按「分」建模，展示会除以 100，
> 而 `paypalAmountValue` 把同样的 cents 当整数发出 —— 两面理解不同，属“接真多币种/FX 时连定价一起定口径”（N2）；
> 单独改展示层只会让两侧更不一致，所以 `formatMoney` 与旧代码行为逐字相同。
缺：收藏/心愿单、退货 RMA、订单取消、地址簿、多语言路径。

### 3.18 后台会话边缘缓存与保活（2026-10-25 上线）
| 项 | 真相 |
|---|---|
| 模块 | `apps/admin/lib/session-cache.ts`（新）+ `lib/auth.ts` 的快路/回退/回填；绑到 Cloudflare **KV** `SESSION_CACHE`（id `cd8b2a2b06244afdb918bf873f9ae535`） |
| 存什么 | **只存已验证过的** `{userId, permissions}`；key = SHA-256(会话 token)，不落原凭据；**不缓存 null** |
| TTL | 60 秒。语义代价：**改别人的权限最长 60 秒生效**；登出即时（`/api/auth` catch-all 在 sign-out 后删 key），但 KV delete 传播最长约 60s；**只能清除自己这一份，无法强制作废别人的会话** |
| 失效方向 | KV 任何异常（读/写/删、无绑定）一律吞掉并退回 better-auth 权威路径 —— 缓存故障只会变慢，不会变错也不会进不去 |
| 实测 | `/products` 2487→~850ms、`/orders` 2235→856ms、`/content` 2484→857ms（单查询页进 1 秒）；多趟页面未达标：`/categories` 1337ms（2 趟）、`/team` 1216ms（3 趟） |
| 安全反证 | 篡改/垃圾/无 cookie 三种情况都只拿到软跳转壳（`permissions: []`），无数据泄露；人节奏 15/15 无 503；密集刷同一页 20 发/0.6s 会撞 `exceededCpu`（4 次 503） |
| ⛔ 已否决 | **B 方案（绕过 better-auth 直查会话表）不成立**：cookie 是 `token.HMAC签名`（长 81）而 DB token 长 32，`getSessionCookie()` 只取值不验签 —— 做快路等于复刻私有验签。取证见 `docs/PERF.md` §2 |
| 后台保活 | `apps/jobs/index.ts` `keepWarmAdmin()` 搭 5 分钟 ISR cron 打 `admin/signin`（成本 0：288 请求/天 = 免费额度 0.3%）。⚠ **效果尚未复量**（闲置后首发），代码注释已承诺“没效果就删” |
| 侧栏高亮 | `AdminSideNav.tsx` 的 `isActive` 改为**最长匹配唯一**（同一时刻只亮一个入口）；前缀匹配会让 `/products/import` 连带亮“商品管理”，而详情页 `/products/<id>` 又确实该归它 —— 候选集只算当前权限下看得见的入口 |

---

## 4. 权限守卫覆盖矩阵

### 4.1 收口后的现状（2026-10-21）
| 写动作 | 文件 | 强制的权限点 |
|---|---|---|
| 改基价 / 上下架 / 改库存 / 传图 / 删图 / 移图 / 存富文本 / 富文本插图 / 挂类目品牌 | `app/products/[id]/actions.ts`（10） | ✅ `product:write` |
| 存商品 SEO 覆盖 | 同上文件 | ✅ `seo:write` |
| 新建商品 | `app/products/new/actions.ts` | ✅ `product:write` |
| **标记发货**（账本+库存） | `app/orders/[id]/actions.ts` | ✅ `order:write` |
| CSV / URL 导入 | `app/products/import/actions.ts`（2） | ✅ `product:write` |
| 类目增改 / 类目↔属性挂载（4）/ 品牌增改（2） | `app/categories/**` `app/brands` | ✅ `category:write` |
| 属性定义增删改 | `app/attributes/actions.ts`（3） | ✅ `config:write`（**由“运营可用”收紧为 super_admin 专属**，对齐 §7：定义目录 schema = 配置权） |
| 法律文档保存 | `app/legal/actions.ts` + `queries/legal.ts` `upsertLegalDoc`/`getLegalDoc` | ✅ `seo:write`。**审查 M-2**：旧可空 `market_id` 进唯一索引对 NULL 不约束、“只一个 current”无约束 → 并发双保存出双 isCurrent、`getLegalDoc limit(1)` 无排序随机展。现 `ld_current_uq` 部分唯一 (type,locale,coalesce(market)) WHERE is_current + 版本索引 coalesce（迁移 0022）、`getLegalDoc` 加 `orderBy desc(version)`、upsert catch 23505 转更新；`smoke:legal` 实测 |
| 内容 CRUD/发布 | `app/content/actions.ts`（5） | ✅ `seo:write` |
| 评论审核 | `app/reviews/actions.ts` | ✅ `product:write` |
| 市场创建 | `app/markets/actions.ts` | ✅ `market:write` |
| 团队/角色 | `app/team/actions.ts`（3） | ✅ `role:manage` |

**静态审计结果**（逐文件正则）：13 个 `actions.ts` 共 **34 个导出动作，`requirePermission` 出现 34 次**，`requireAdmin` 与裸 `getSession` 均为 **0**。
**验证**（真实 DB 账号）：`staff@test.local` 运行时权限集 = `{category,order,product,seo}:write` → 新守卫会拒 config/market/role，放行其余 4 项；两个 super_admin 账号 = 全 8 权。另 7 包 `typecheck` 全过 + admin `next build` 过 + core 28 单测全过。

### 4.2 仍属未开工（不属本次范围）
❌ 2FA/Passkey、step-up、会话撤销 UI、审计 diff、**退款限额**（`refund:write` 已定义但无退款动作可守 → 接退款时必须同时加限额守卫）、Cloudflare Access 包住 admin 子域。

---

## 5. 部署 / 运维现状

| 项 | 真相 |
|---|---|
| Workers | `onestarry-com`（web）· `onestarry-admin`（admin）· `onestarry-jobs`（cron，crons **三条** `* * * * *` + `*/5 * * * *` + `20 4 * * *`；第三条是数据保留，第二条跑 ISR 探针+保活，第一条跑 relay） |
| 绑定 | web：Hyperdrive `797e79…` + R2 `onestarry-media` + R2 `onestarry-isr-cache` + DO `NEXT_CACHE_DO_QUEUE` + service 自引用；admin：Hyperdrive + R2 `onestarry-media` + **KV `SESSION_CACHE`**（后台会话边缘缓存，见 §3.18）；jobs：仅 Hyperdrive |
| CI | **Cloudflare Workers Builds**（三 Worker 各自“就地连接 Git”，push main 自动构建）；**无 `.github/workflows`**。✅ 2026-10-21 仓库侧门禁已就位：`pnpm typecheck`（8/8）+ `pnpm test`（119/119）一键可跑；⚠️ **lint 不在门禁里**（T22：eslint 从未接通）。构建走 `cf:build`（含临时过桥 flag）；**Dashboard 的 Build command 仍待人工改一次**：改成 `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm --filter @onestarry/<app> run cf:build` |
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
| 便捷入口 | `pnpm seed:all`（ledger→catalog→demo→admin）· `pnpm db:partition` · `pnpm db:studio` · **`pnpm scan:dead`** | `scan:dead` = `scripts/dead-scan.mjs` 图遍历式死代码体检（认 barrel 再导出 / Next 约定入口 / wrangler `main` / 构建期 `.mjs`）；退出码可挂 CI。⚠ “无调用方”不等于无用，未接能力看 §9 |
| 构建指纹 | `scripts/build-stamp.mjs`（由两个 `next.config.ts` 在构建期引入）注入 `APP_GIT_SHA`/`APP_BUILD_TIME` → `/api/health` **顶层** `gitSha` 暴露。**判定“新构建是否已上线”只能比它**（Workers Builds 会静默漏 push） |
| smoke（15 个，`db/src/smoke-*.ts`） | `smoke` / `smoke:catalog` / `smoke:inventory`（含 `receiveStock` 原子写路径）/ `smoke:pricing` / `smoke:outbox` / `smoke:orders` / `smoke:create-order` / `smoke:sellability`（归档/缺货/不足/禁售四类各被挡 + 正常放行，验 H2）/ `smoke:payments` / `smoke:payments-posting` / `smoke:payments-reversal` / `smoke:refund-dedup`（同笔退款被部分唯一索引拒，验 M5）/ `smoke:shipment` / `smoke:media`（商品图三步写的原子性 + products 行锁 + 共享 media 只解绑，验 L-3；第二条连接等锁到 `lock_timeout` 是行锁的判据，所以父行必须用**已提交**的探针商品） / `smoke:retention`（有界分批删：跨批计数取 `.returning()` 真删行数、内层子查询必须真带 LIMIT、窗口口径不得因改写变宽 —— 验 0016 登记的那颗延迟炸弹）（另有 `jobs/src/relay.smoke.ts`、`jobs/src/relay.retry.smoke.ts`（failed 回队重试→超阈 dead、未知置 dead，验 H1）、`jobs/smoke-admin-pricing.ts`） | 连真实 Neon 冒烟，人工触发 |
| 连接 | 根 `.env.local`（`DATABASE_URL` 池化 / `DATABASE_URL_UNPOOLED` 直连），seed 用 `dotenv config({path:"../../.env.local"})` | ⚠️ 从不同 cwd 跑脚本时路径解析会失效 |

**本地开发**：`pnpm dev`（turbo 并行起 web + admin，各自 `next dev` 默认 3000，冲突时后者自动进位到 3001；jobs 用 `wrangler dev`）。`apps/web/lib/db.ts` `getDb()` 在无 `getCloudflareContext()` 时回退 `process.env.DATABASE_URL`，所以前台页面可直接 `next dev` 渲染真实数据（**日常验证首选，秒级**）。

---

## 7. 测试现状

| 层 | 真相 |
|---|---|
| 单测 | `packages/core/src/*.test.ts` **18 个**（pricing/sellability/shipping/shippingProvider/payments/**paypal**/csv/maintenance/health/isr/invalidate/**site-status**/**admin-guard**/cartMap/fetchGuard/legalBody/orderNumber/safeOutput），跑法 `tsx --test`（**node:test，不是 Vitest**）；根 `pnpm test` → turbo `test` task → **现 125/125 全过**（2026-10-29 实测）。内置**三道漂移护栏**：① `maintenance.test.ts` 读 `apps/web/package.json` 断言 Next 主版本与核心常量一致；② `site-status.test.ts` 扫 `apps/web/app` 源码，断言每个 `page.tsx` 都已登记、声明为整页 ISR 的动态段路由**必须有 `generateStaticParams`**、登记的 `revalidate` 与源码一致、cron 表与 `apps/jobs/wrangler.jsonc` 一致 —— 把「缓存坏法无声」变成就近失败（背书见架构方案 §22）；③ **`admin-guard.test.ts`（审查 L-8，2026-10-29）**扫 `apps/admin/app` 所有 `page.tsx`，断言除显式白名单（仅 `/signin`）外**每页都必调用 `requirePermission`/`requireAdmin`、且必从 `@/lib/auth` 导入**，并反向盯白名单与页面数下限防测试本身空转。**已坐实现状：19 页全守、无敞着页面；此护栏防的是“以后漏一页就静默数据泄露”**（后台根 layout 故意软取会话不跳转，故 **layout 不构成兜底**）。**已评估并否决“加 middleware”方案**，理由写在该文件头注 |
| turbo | ✅ 已加 `test` task 与根 `pnpm test`（现 **125/125**）；`pnpm typecheck` 现 **8/8 全绿**（shared 空壳已删，D14/N17 结案）。⚠️ `pnpm lint` 仍会红 —— 见 §12.2 T22 |
| 集成 | 靠 11 个 smoke 脚本连真实 Neon（人工触发）；另有 `pnpm scan:dead` 做仓级死代码体检（见 §6） |
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
| 6 认证与 RBAC | ✅（本轮补） | 双实例+三档+权限点表 ✅；**§4 守卫已全量收口**（34 动作 + 13 页 + 导航过滤 + HTTP 注册封）；仍缺 2FA/step-up/审计/退款限额 |
| 7 商品目录 | ✅ | 含属性定义/slug 单一真源/媒体/译文；变体矩阵 `productOptions/optionValues` ⛔ 未用 |
| 8 库存 | 🟡 | 水位+流水+发货扣减 ✅；**下单原子占位+超卖防护+未付过期回收 ✅（H-2，`smoke:reservation`）**；秒杀热行 Redis Lua / `inventory_reservations` 独立表 ❌ |
| 9 定价与可售性 | 🟡 | 物化管道+inputsHash+price_history ✅；四个 provider 占位（D01）、`computeSellability` 未接（D02） |
| 10 搜索与 outbox | ✅/🟡 | outbox+relay+cron+写时自派发 ✅；搜索用 Postgres FTS（Typesense 为规模路径），handler 只有 1 条 |
| 11 结账与订单 | 🟡 | 主链通 ✅；**下单占位防超卖 ✅（H-2）**；运费/市场硬编码 + 无 magic link（D03） |
| 12 支付与税务关税 | 🟡 | PayPal Orders v2 全链路代码就位（建单/扣款/验签/**反向红冲**）但**未跑过真 API**（待凭据）；Fake PSP 全链路通；Stripe/Tax/LandedCost ❌；disputes/payouts 落库 ❌ |
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
| N3 | 运费进结账 | `core/shipping.ts` `computeShipping` + `shipping_rates.rate_table` 已在；占位值已收敛为**单一真源 `core/shipping.ts` 的 `PLACEHOLDER_SHIPPING_CENTS`**（cart/checkout 展示与 `createOrder` 落账三处同读一个，不再各自写死 500）；接真时把这三处改成调用 `computeShipping` 算得的 shippingCents 并删常量 |
| N4 | 可售性接线 | `core/sellability.ts` → `browseProducts`/`getProductById`/`getCartLines` 三处读取路径 + `product_market_availability` 表启用 |
| N5 | 真实幂等键 | `checkout/actions.ts`：由客户端提交前生成并复用（同一表单一次提交一个 key），命中 `IDEMPOTENT_REPLAY` 时返回原单号 |
| N6 | ~~权限守卫统一~~ ✅ **已完成 2026-10-21** | 34 动作全 `requirePermission` + 13 页升级 + `readAdminSession` 单一读取点 + AdminNav 按权限过滤 + 后台 HTTP 封公开注册（详 §4） |
| N7 | 内容页进 sitemap | `apps/web/app/sitemap.ts` 加 `listPublishedContent` 的 blog/page/landing |
| N8 | 退款 | 新建 `queries/refunds.ts`（表已存在）+ 后台退款动作（`refund:write`）+ `creditNotes` |
| N9 | 交易邮件 | `packages/email`（未建）+ 新增 outbox handler：`order.created/payment.succeeded/order.shipped`（`jobs/src/handlers.ts` 注册表就是为此留的）。⚠ **动手前先做 relay 原子认领**（§3.9 relay 行 / 审查 L4）：现在 Cron 与写时自派发可重叠，非幂等 handler 一接上就是重复发信 |
| N10 | 发票 PDF → 私有桶 | 建 `onestarry-files` 桶 + `FILES` 绑定 + `invoices.pdfKey`（列已在 foundation/invoices？若无则字段级迁移） |
| N11 | 入库成本分录 | `queries/integration.ts` `receiveStock` 内 `TODO(§13)` |
| N12 | pg_dump 定时冷备 | Worker 不能 exec → 需一条 GitHub Actions schedule（本仓当前无 `.github/`） |
| N13 | 集成 API 严格验签（可选加强） | 共享密钥闸已上（审查 C1：`INTEGRATION_SECRET` + `X-Integration-Key`，未配→503）；剩 JWKS 验 `cf-access-jwt-assertion` + scope + IP allowlist |
| N14 | CMS 阶段2/3 | `ContentEditor` 加 Image 扩展 + 上传 action（R2 key `content/{contentId}/`）；content 的 seo_meta 面板复用 `upsertSeoMeta` |
| N15 | 测试进流水线 | `turbo.json` 加 `test` 任务；（可选）把 `tsx --test` 换 Vitest 以对齐文档，或改文档 §12 |
| N16 | ~~Next 15 支持窗已过 → CI 构建失败~~ | ✅ **已解 2026-10-21**：升到 Next 16.4.2 + wrangler 4.151.3，`cf:build` 的过桥 flag 已摘（详 §12.4 T18）。保留的教训（写进§12.6）：**CI 直调 `exec opennextjs-cloudflare build`、不走 npm 脚本** —— 构建期参数写在 `package.json` 里对 CI 无效，要么改 Dashboard、要么把构建收进 `cf:build` 并改指一次 |
| N17 | ~~`pnpm typecheck` 被空壳包卡住~~ | ✅ **已结案 2026-10-21**：选②（删包 + 清 `transpilePackages` 引用），根 `pnpm typecheck` 8/8 全绿。若将来真需要 money/i18n/pagination 共享工具，放 `packages/core`（单入口），不再保留两个“共享包” |

---

## 10. 偏差登记表（架构文档 ↔ 代码，逐条）

| # | 文档位置 | 文档说的 | 代码做的 | 影响 | 处置建议 |
|---|---|---|---|---|---|
| D01 | §3.3/§6.1 | 全包价 = 基价+税+关+运费，税由 Stripe Tax/LandedCost 权威 | `taxRate/dutyRate/shippingCents=0`、`fxRate=1` 硬编码进事件 payload | 展示的"全包价"其实没有税关；US DDP 不成立 | 见 N2；在此之前架构文档 §3.3 标"MVP 占位" |
| D02 | §5 | `computeSellability` 是四处共用的单一函数 | 零调用；可售性只看 vmp.blocked + status | 商品级市场可用性/禁售类目/配送区覆盖**不生效** | 见 N4 |
| D03 | §6.1/§6.6 | 结账必算运费、进 VAT 税基、整票阈值分支 | 运费 500 常量、无阈值校验、市场硬编码 us | 多国/多市场立刻失真 | 见 N3/N5 |
| D04 | 铁律②/§7 | 每个 Server Action 强制 authz | ✅ **已收口 2026-10-21**：34/34 动作 + 13/13 页全 `requirePermission`，导航按权限过滤 | （原：低权角色上线即全线破防）| 已完成；回归时只需跑 §4.1 的静态审计正则 |
| D05 | §14 | 加国家 = 纯配置（运费/税则/合规/PSP 全后台配） | 只有 `markets` 行 + 后台"市场创建"；其余配置表无读代码、无配置页 | "纯配置加国家"目前**不成立** | 分两步：先接线（N2/N3/N4），再补后台配置页 |
| D06 | §1/§43 §2/§58/§162 | 异步层 = Inngest | Workers Cron + `runRelayBatch`；handler 仅 1 条 | 文档误导后来人 | 文档已在本轮回写（见 §11） |
| D07 | §1 L37/§5/§10 | 搜索 = Typesense 默认，outbox → Typesense | Postgres FTS（generated tsvector + GIN）；无外发 | 分面/容错/即时建议客户端直连都没有 | 保留为规模路径（§15.1‑5 已注明阈值） |
| D08 | §1 L38/§6.2 | 缓存 = Upstash Redis（购物车/会话/限流/秒杀） | 未引入；购物车 = httpOnly cookie | 结账限流、秒杀预扣不存在 | 上线前补限流（Turnstile + rate limit）；Redis 标"按需" |
| D09 | §1 L45/§13 | 邮件 = Resend + React Email | 完全未开工 | 下单/发货/退款无通知；`consents` 无写入方 | 见 N9 |
| D10 | §10.2 L245-249 | ISR 三件套含 **D1 Tag Cache** + revalidateTag + 边缘 purge | 只配 R2 + regional + DO queue，**无 tagCache、零 revalidateTag** | 后台改动最多陈旧 60s；无法即时失效 | 有意取舍（文档"方案 B"）；要即时生效就补 D1 + L3.1 purge |
| D11 | §10.3 L278-279 | "R2 现状 = 无读写代码、桶内空" | **已过时**：media.ts/上传动作/URL 抓图/公开域 `media.onestarry.com` 全在用 | 文档误导 | 本轮已回写 |
| D12 | §12/§1 | core Vitest / CI GitHub Actions | `tsx --test` + Workers Builds；无 workflow、turbo 无 test 任务 | 测试不会自动跑 | 见 N15 |
| D13 | §3.7 | customer 业务属性进 `customer_profiles` | 表在，零引用（前后台都没读写） | 偏好语言/市场/营销开关无处落 | 接前台偏好时一并启用 |
| D14 | §13 | 集成契约 zod 单一真源进 `packages/shared` + OpenAPI | `packages/shared` 是**空壳**（package.json 指向不存在的 src） | 外部程序无契约可依 | ✅ **2026-10-21 已删包**（走“从文档删掉这条承诺”路线）；契约层若要做，放 `packages/core` 或新建 `packages/contract`，别再用 shared 这个名字 |
| D15 | §7/§15.2 | 后台强制 2FA/Passkey、审计 diff、财务限额；**不开放公开注册** | ✅ 注册面已封（HTTP 层 `/sign-up*` → 403，`lib/authGuard.ts`）；❌ 2FA/审计/限额仍 ❌ | 原风险：任何人可自助注册后台账号 | HTTP 拦截已上；**未用 better-auth `disableSignUp`**（会连带拒掉进程内建号 → 团队页就废了）；2FA/限额待开工 |
| D16 | §1 L30 | "以 OpenNext 当前稳定支持版本为准，不死守 15" | ✅ **已落地**：实装 Next **16.4.2**（支持窗至 2027-10-21）+ wrangler 4.151.3；此前钉在 15.5.28 且 2026-10-21 起被 OpenNext 拒构建 | 部署能力恢复（待分支合并后由 CI 验证） | N16 结案；下一次升级请提前 6 个月（≈2027-04 开始） |
| D17 | 无（本轮新发现） | — | 本地 Windows 跑不了 `opennextjs-cloudflare build`：Next standalone tracing 建符号链接 `EPERM`（需开发者模式/管理员） | admin 的 worker 本地预览不可用，e2e 只能靠真机部署或连库脚本 | 要本地预览：开 Windows 开发者模式或用 WSL；不阻塞交付 |

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

---

## 12. 模板完备性体检（2026-10-21 · 视角＝「别人拿走能不能立起一个站」）

> 与 §9 的分工：§9 列的是**业务功能**没通电；本节列的是**作为一份可交付模板**还缺什么 —— 换皮彻底性、质量门禁、安全默认值、版本时间炸弹。每项都带本轮**实测证据**（扫描命令/文件行号/真实输出），不是印象。

### 12.1 A 组 · 换皮可交付性

| # | 项 | 状态 | 本轮证据 | 影响 / 建议动作 |
|---|---|---|---|---|
| T1 | 站级身份单一真源 | ✅ 已收口（2026-10-21） | `packages/core/src/site.ts` 已集中 `SITE_ORIGIN / SITE_NAME / MEDIA_PUBLIC_BASE`，web 的 layout / sitemap / robots / PDP 均已从中取（true-brand 扫描不再命中它们）；**当时仍有 8 处代码字面量绕过它**（已清零，清单见右列）：`apps/admin/app/layout.tsx`（title `onestarry · Admin` + description `OneStarry 管理后台`）、`apps/admin/components/AdminNav.tsx:47` 顶栏、`apps/web/app/search/page.tsx:10` 描述、`SiteFooter.tsx:9`、`SiteHeader.tsx:9`、`packages/auth/src/index.ts:19,30` 两个 `appName` | 换皮者照文档只改 site.ts → 后台标题、页脚、auth 发出的邮件品牌仍是旧名。**已做**：这 9 处（admin layout 的 title + description、AdminNav 顶栏、search 描述、SiteHeader、SiteFooter、auth 两个 `appName`）已全部改成 `import { SITE_NAME }`；`packages/auth` 为此新增 `@onestarry/core` 依赖（core 是无依赖叶包，方向健康）。（wrangler 里的 worker/桶名、`api/health` 与 jobs 的 `service` 字段、importProviders 的 UA 属**基础设施命名**，保持字面量即可） |
| T2 | 换皮主文档过时 | 🔴 | `docs/REBRAND.md` §1 写着「`SITE` 常量散在前台」并给 9 文件批量替换表 + 「重构机会」注 —— 实际该重构**早已完成** | 换皮者按表全量 replace 会误伤（把 site.ts 之外不该动的一起改）。→ 本轮已改写 §1 |
| T3 | README 部署表与事实不符 | ✅ 已核对并回写（2026-10-21） | 表里 web/admin 的 Build command = `pnpm --filter @onestarry/web build`（= `next build`），但 `apps/web/wrangler.jsonc` 的 `main` 指 `.open-next/worker.js`，只有 `opennextjs-cloudflare build` 才产出它；而站点确实能 push 即部署 ⇒ Dashboard 里的真实命令 ≠ 表格 | 模板门面步骤被照抄就必炸。→ 用户已从 Dashboard 抄回真实命令：**Build = `pnpm install --frozen-lockfile && pnpm --filter @onestarry/web exec opennextjs-cloudflare build`**、Deploy = `... exec wrangler deploy`、版本命令 = `... exec wrangler dev`、根目录 `/`。README 已按实回写（admin 仍标“待核对”）。**关键发现**：CI 直调 `opennextjs-cloudflare build`，**不走 npm 的 `deploy` 脚本** ⇒ 任何构建期 CLI 参数写在 `package.json` 里对 CI 无效；建议把构建收进 `cf:build` 脚本、Dashboard 只调 `run cf:build`，以后参数增删全在 git 里可审计 |
| T4 | LICENSE | ✅ 已建 `LICENSE.md`（2026-10-21） | 仓库根原无 LICENSE | 用户定调“只给自己用、不对外”→ 已放一份**内部权属与分发边界声明**（保留所有权利 · 仅内部复用 · 不得对外分发 · 第三方依赖仍按各自许可证），并注明对外授权前需法务复核。价值不在法务而在防误操作（仓库转 public / 外包 fork / 误发 npm） |
| T5 | 跨平台可跑性 | ✅ 已修（2026-10-21） | 原 `clean` = `turbo run clean && rm -rf node_modules`，PowerShell/cmd 无 `rm -rf` | → 改成 `node -e "require('fs').rmSync('node_modules',{recursive:true,force:true})"`，三平台一致 |
| T6 | 死配置 | ✅ 已删（2026-10-21） | `turbo.json` `globalEnv` 含 `NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_DEFAULT_LOCALE`；但**全仓 `NEXT_PUBLIC_*` 引用数 = 0**，`.env.example` 里也没这两项 | 新人会改完发现不生效。→ **已删**：`turbo.json` 的 `globalEnv` 仅留 `NODE_ENV` / `DATABASE_URL` / `DATABASE_URL_UNPOOLED`（后两项是构建期预渲染真用的，不可删）。若将来真要做“前端可配”，应从 `site.ts` 派生而不是添死变量 |
| T7 | `@onestarry/shared` 空壳 | ✅ 已删包（2026-10-21） | `packages/shared/src` 不存在（Test-Path False）；`apps/{web,admin}/next.config.ts` 的 `transpilePackages` 仍列它；根 `pnpm typecheck` / `pnpm build` **整仓红**（原 D14/N17） | → **已删除**：`packages/shared/package.json` 移除 + 两个 `transpilePackages` 清引用 + `pnpm install` 刷 lockfile。**验收**：`pnpm typecheck`（turbo）**8/8 成功 EXIT 0**、`pnpm -r typecheck` 7 包全 Done —— 仓库级命令首次全绿。注：本地可能残留空目录 `packages/shared/`（git 不跟踪空目录，clone 后不存在），可手工删 |

### 12.2 B 组 · 质量门禁（决定别人敢不敢动代码）

| # | 项 | 状态 | 本轮证据 | 影响 / 建议动作 |
|---|---|---|---|---|
| T8 | CI 里没有测试 | 🟡 本地门禁已建，CI 待改 | 无 `.github/`；Workers Builds 只跑 build+deploy；`turbo.json` **没有 `test` task**；根 `package.json` **没有 `test` 脚本** | ✅ **已修仓库侧**：新增根 `"test": "turbo run test"` + `turbo.json` 的 `test` task；`pnpm test` 实测 **28/28 通过 EXIT 0**（目前只有 core 有单测；db/jobs 的 `smoke:*` **故意不进 CI** —— 它们会往真库写数据）。⚠️ **待用户在 Dashboard 改一次**：Build command 改成 `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm --filter @onestarry/<app> run cf:build`，这样类型/测试挂了就不会部署 |
| T9 | 无预览环境 / 无 e2e | 🟡 已找到原生入口 | web/admin 各只有一个生产 Worker；本地 `opennextjs-cloudflare preview` 在 Windows 因 symlink EPERM 跑不通（D17）；无 Playwright。**但 Dashboard 实测：「非生产分支构建」已勾选**（任何分支 push 自动跑完整构建、生产不动）；**「Set up Worker Previews」存在且未启用** | 分支构建就是升级的第一道回归网（typecheck+build 失败=构建失败）。Preview 建议启用，但 ⚠️ **preview Worker 沿用同一套 Hyperdrive/R2 绑定 ⇒ 连的是生产 Neon**，只能验证渲染/交互，**不得在 preview 上下单/改价/发货**，除非同时接 Neon 分支隔离 |
| T10 | 后台缺错误边界 | 🟡 | `apps/admin/app/not-found.tsx`、`error.tsx` **均不存在**（web 侧 `not-found/error/global-error` 三件套齐全 ✓） | 后台任一渲染异常 = 整页白屏，运营会以为挂了 |

### 12.3 C 组 · 上线要过的安全与运维默认值

| # | 项 | 状态 | 本轮证据 | 影响 / 建议动作 |
|---|---|---|---|---|
| T11 | Better Auth 未限流 | 🔴 | `packages/auth/src/index.ts` 全文无 `rateLimit`、无 plugins 配置，customer/admin 两实例都是裸的 | 后台登录口可被爆破，且模板的安全默认值应该是「开箱就防」。→ 配 `rateLimit: { enabled: true, window: 60, max: 10 }`（或在 CF 侧对 `/api/auth/*` 上速率规则；注意 Worker 内限流需 KV/DO 存计数） |
| T12 | 后台不开放注册 | ✅ | 本轮已封（§4.1：HTTP 层 403 `/sign-up*`）；前台 customer 注册仍开放，符合预期 | 核对项，非缺陷 |
| T13 | 真收款 | 🟡 | PayPal（Advanced Control / Orders v2）服务端已写完：凭据缺失时 fail-closed（支付页明说未配置、webhook 501）、沙箱凭据默认不得动账、反向事件会冲账。但**从未打过真 PayPal API** —— 未拿到凭据前不能称“已跑通” | 下一步只在人：建 App → 配 5 个 Workers 变量/secret → 建 webhook 订阅 → 拿沙箱走一遍（要显式开 `PAYPAL_ALLOW_SANDBOX`）→ 切 live 真收一笔 |
| T14 | 错误可观测 | 🔴 | 无 `apps/web/instrumentation.ts`、无 Sentry/任何告警；Cron relay 失败只落在 Workers 日志里 | 静默失败 = 价格不更新/订单不落账而没人知道。→ 模板应内置最小告警：jobs Cron 批次失败 → 一次出站通知（邮件 or Slack webhook），并把 Workers 日志接入 Grafana/Loki 写成文档步骤 |
| T15 | 财税冷备自动化 | 🟡 | DR-RUNBOOK §2/§7 标 🟥（手动 `pg_dump`）；且 §7 仍写「GitHub Actions 定时 workflow」= 过时术语（本仓无 GH Actions） | 与 N12 同条。→ 顺手把该句改成「Workers Cron 或外部定时任务」 |
| T16 | workerd 兼容日期 | 🟢 | `compatibility_date: 2026-01-01`（距今 >6 个月），OpenNext 构建对此**只 warn 不拦** | 不升不炸，建议随 T18 一起更新 |

### 12.4 D 组 · 版本时间炸弹（本轮事故的机制说明，逐条实测）

- `@opennextjs/aws@4.1.11` 的 `NEXT_RELEASE_DATES` **只登记到 16**（`16: "2025-10-21"`、`15: "2024-10-21"`），判定式为 `now <= release + 2 年`（helper.js:229-256）。
- **未登记的主版本一律 `return false`（判为不支持）**（helper.js:249-251）—— 也就是说「装一个更新的 Next」并不自动过关，还得有更新版 OpenNext。
- 本机实测：`NOW_UTC=2026-10-21T11:47Z` → Next 15.5.28 `SUPPORTED_NOW=False`；不允许时 `process.exit(1)`（helper.js:280）。
- registry 现状：`next@latest = 16.4.2`；`@opennextjs/cloudflare@latest = 1.20.12`（**正是我们已装版本**），其依赖硬锁 `@opennextjs/aws@4.1.11` ⇒ 没有「更新的表」可拿，只能升 Next 或走 flag。
- 逃生阀 `--dangerouslyUseUnsupportedNextVersion` 的默认值是硬编码 `false`，**不读环境变量**（对比同文件的 `skipWranglerConfigCheck` 会读 `SKIP_WRANGLER_CONFIG_CHECK`）⇒ 只能写进命令行（package.json 脚本 or CI 的 Build/Deploy command）。
- 还有第二道：`ensureNextjsVersionSupported` 硬拦 `next < 14.2`，并对 **Next ≥16.1 要求 wrangler ≥4.59.2**（workerd 的 setImmediate 修复，cloudflare/dist/cli/utils/nextjs-support.js）；本仓三处均声明 `wrangler ^4.28.1`，registry 最新 `4.151.3`。
- `opennextjs-cloudflare build` 的**第一步**就是这道闸门（cli/build/build.js:34-38）⇒ 部署路径必过 ⇒ 从今天起任何新部署失败。**现网不受影响**：Workers 保留历史版本，控制台 Versions 可把上一版本调回 100%。
- ✅ **已核对 CI 实际命令（T3）**：web 的 Build command = `pnpm install --frozen-lockfile && pnpm --filter @onestarry/web exec opennextjs-cloudflare build` ⇒ 确认部署路径逐次经过这道闸门，Dashboard 已出现“上一次构建失败”红条。⚠️ 它**不走** `package.json` 的 `deploy` 脚本 → **只改 npm 脚本无法给 CI 过桥**；要么改 Dashboard 命令，要么新增 `cf:build` 脚本并把 Dashboard 改指 `run cf:build`（后者只需改一次，以后 flag 的加与删都在 git 里）。

| # | 项 | 优先级 | 一句话 |
|---|---|---|---|
| T17 | 过桥：构建收进 `cf:build` 脚本 | ✅ **已拆桥**（2026-10-21）：flag 已随升级删除，`cf:build` 现为干净的 `opennextjs-cloudflare build` | 历史：升级期间靠该 flag 恢复部署能力；因 CI 直调 `exec opennextjs-cloudflare build`，**写在 npm 脚本里的 flag 对 CI 无效**（这是本轮最值钱的一条认知） | 遗留动作（非应急）：把 Dashboard 的 Build command 改指 `run cf:build` + 加 `pnpm typecheck && pnpm test` 两步，收益是参数只住仓库、门禁前置；**不改也能部署**（旧命令在 Next 16 上能过闸门） |
| T18 | 正解：升 Next 16.4.2 | ✅ **已完成（2026-10-21，分支 `chore/next-16`）** | 实装 next **16.4.2** / react 19.3.1（peer 未变，无需动）/ wrangler **4.151.3**；root `engines.node` 提到 `>=20.9`。**命中面核查全部免改**：24 处 `params/searchParams` 已 Promise+await、cookies/headers 已 await、无 opengraph-image/icon、sitemap 无 `id`、无 experimental_ppr/unstable_/next lint、无自定义 webpack。**验证**：`pnpm typecheck` 8/8、`pnpm test` 28/28、admin `next build` ✓、web `next build` ✓（**构建期连真 Neon 预渲染 10/10 页**）、`cf:build` 已过版本闸门（日志 `Next.js version : 16.4.2` → 进入 Bundling），只剩 Windows symlink EPERM（D17；Linux CI 无此问题） |
| T19 | 稳态：`pnpm deps:window` 自检脚本 | ✅ **已实现（2026-10-21）** | 真源 = `packages/core/src/maintenance.ts`（纯函数：`NEXT_MAJOR_RELEASE_DATES` 抄自 OpenNext + `computeMaintenanceWindow` + `requiredWranglerMin` + `compatDateStale`）；CLI = `packages/core/src/scripts/deps-window.ts`，根脚本 `pnpm deps:window`（默认 warn-only 退 0，`--strict` 才拦）。实测输出：next 16.4.2 → 支持至 2027-10-21 → 剩余 364 天 [ok]；wrangler 4.151.3 ≥ 4.59.2 [ok]；三处 `compat_date 2026-01-01` [warn]。**另带漂移护栏**：`maintenance.test.ts` 直接读 `apps/web/package.json` 断言 `DECLARED_NEXT_MAJOR` 与实际主版本一致 —— 把「日期一到突然 exit 1」的外部门变成提前 ≥60 天的内部信号；建议把它放进 CI Build command（warn-only、不拦） |
| T20 | 节奏：文档写死「≤2 年必须做一次 Next 主版本升级」+ 升级 runbook（分支预演 → 迁移在 Neon branch 跑 → typecheck/test/build → Versions 放量） | P1 | 模板的长期可维护性说明，见 §12.6 |
| T21 | **预警可见面放后台**（用户 2026-10-21 提问触发）→ 同日按用户定调**重做**：“后台是唯一触发器” | ✅ **已实现并按新前提加强（2026-10-21）** | 实现：`core/maintenance.ts`（纯函数真源）+ `deps-window.ts`（CLI）+ `OpsPanel`（概览卡）+ `AdminNav` 导航条提醒 + `getOutboxHealth`。**加强理由**：用户明确“不会每月看一次依赖”，所以只提前 60 天不够 → 新增 `ACTION_LEAD_DAYS=180`，**提前半年就亮黄条**，且文案必须给**具体开工日**（例：`建议 2027-04-24 前开始升级`）而不是“还剩 N 天”；提醒不只住在概览页，**任何页面的导航条**都挂黄/红条 + 入口小徽章（仅 `config:write` 可见）。单测 40/40（含开工日计算与 181/180 边界）。已知局限：不上后台就看不到 —— Resend 接线（N9）后把窗口告警推邮件 |
| T22 | **lint 面从未接通**（本轮新发现，2026-10-21） | 🔴 | 只有 `packages/config` 装了 eslint（^9.17.0）并写了 `eslint.config.mjs`（已导出 `@onestarry/config/eslint`，注释里还写了用法）；但 **9 个包/应用没有一个建自己的 `eslint.config.mjs`**，其中 auth/core/db/jobs 四个声明了 `"lint": "eslint ."` 却**没有 eslint 依赖**，且根 `node_modules/.bin/eslint` 不存在 → `pnpm lint` 必报「'eslint' 不是内部或外部命令」（turbo 实测：1 task / 0 成功 / EXIT 1）。web/admin/ui 则根本无 lint 脚本 | 所以 **CI 门禁里暂不含 lint**（否则一上就红）。修法：各包加 3 行 `eslint.config.mjs`（`import base from "@onestarry/config/eslint"`）+ devDep `eslint ^9`，然后一次清掉暴露的告警。→ 不属今日关键路径，单独一批做 |

### 12.5 建议施工顺序（把上面 22 项收敛成一条线）

```
① T7 shared 空壳        —— 先让 pnpm -r typecheck/build 一键全绿（后面所有验证的前提）
② T8 测试门禁 + turbo test —— 建回归网（也是升 Next 的安全垫）
③ T17 过桥 → 恢复部署      —— 期间任何改动都能上线，不再被阻塞
④ T18 升 Next 16.4.2       —— 在 ② 的网上做，逐包 typecheck + 两站 build + smoke
⑤ T1/T2/T3/T4 换皮彻底性   —— site.ts 收口 8 处 + README 部署命令核对 + LICENSE
⑥ T11 限流 / T14 告警 / T10 后台错误边界 —— 上线前安全默认值
⑦ T19 deps:window / T5 / T6 / T15 / T16 / T9 —— 卫生与运维
```

### 12.6 「下一次过期怎么办」的稳态答案

这道 2 年窗口是 **Next 官方支持策略**（每个主版本自发布起维护 2 年）在构建工具里的体现，**无法被永久绕开**：任何钉住的主版本都会在某个日期到期，而 OpenNext 的支持表还会滞后于新主版本发布。所以稳态不是「一劳永逸」，而是**把它变成一项有节奏、可验证、可回滚的常规维护**：

1. **频率**：约每年看一次小版本（`next@16.x`，零风险、拿安全补丁），约每 2 年一次主版本（必须）。目标是在到期前 **≥6 个月**完成升级，而不是当天被 `exit 1` 通知。
2. **安全网（先有网，再动手）**：CI 门禁 `typecheck + lint + test + build`（T8）→ Neon 分支预演迁移（架构 §15.1 分支工作流）→ 部署用 Workers **Versions 分阶段放量**，出问题控制台一键把上一版本调回 100%（秒级、不重新构建）→ 数据侧 Neon PITR 回滚点（DR-RUNBOOK 场景 A）。
3. **升级本身保持小而 boring**：一次只做「依赖对齐」一个提交，业务代码不动；破坏性变更集中在 `params/searchParams` 异步化与 lint/TS 版本，本项目命中面很小（已核：全站无 middleware.ts，`params` 已是 async 写法）。
4. **预警而非救火**：T19 的 `deps:window` 把外部时间闸门变成内部信号，剩余天数进 CI 日志。
5. **模板层面写死**：本节 + 架构文档 §1 的「以 OpenNext 当前稳定支持版本为准，不死守 15」—— 让下一个拿走模板的人不会在同一个日期撞上同一面墙。

### 12.7 升级节奏决定（2026-10-21，用户定调）

用户明确：**没时间每月看一次依赖**，只在看到提醒时才行动。据此定下三条：

1. **不装 dependabot** —— PR 无人看会堆积，反而制造虚假安全感；宁可不要。
2. **后台导航条是唯一触发器**（T21）：提前 180 天亮黄条并给出具体开工日，超窗亮红条。因此 `ACTION_LEAD_DAYS` 重估为半年，不再是 60 天。
3. **主版本升级走四道闸**（详见架构文档 §15.2 ⑯）：分支先构建（已启用）→ 门禁 typecheck/test/build → **Workers Versions 分阶段放量** → Neon PITR 兜底；发版窗口选**北京时间上午 09:00–11:30**（美国深夜低峰，本站是纯海外市场）。关键认知：**部署失败 ≠ 站挂**（今天 CI 连红 4 次而站点 200 就是实证），真风险是“坏版本一上线就 100% 接手”，所以放量+秒级回滚是重点。

## 13. 维护说明（本文档如何保持不过时）

> 本节曾因 §12 插入时的替换错误被误吞（2026-10-21 发现并恢复），故保留在此以免再丢。

- 本文档描述“当前代码事实”，不是计划。任何“未接线/待补”都以仓库实际扫描为准，不手写印象。
- 若后续又有施工，请连同架构文档 §15 一起更新本文件的 §2/§3/§8/§9/§10/§12；三者一致性由 `pnpm typecheck` + `pnpm test` + 静态审计把关。
- 本文件与架构文档冲突时，**以本文件为准**（它更贴近代码），并回改架构文档。
- **改本文档前先用 grep 定位锚点**（教训：Read 对旧文件可能返回过期内容，§13 就是这样丢过一次；改完跑 `git diff --stat` 确认行数变化符合预期）。
