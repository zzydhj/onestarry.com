# REBRAND — 把 onestarry 改造成别的站

这是**模板站**的主用法文档：以 onestarry 为骨架，克隆到新的品牌/域名/仓库，改造成另一家自营电商站。目标：**30 分钟完成换皮、不重写代码、不破坏架构决策**。

> 前置认知：架构方案 v13 冻结（见根目录 [`全球电商模板-架构方案-交叉验证版.md`](../全球电商模板-架构方案-交叉验证版.md)）。换皮**只换字符串/资源名/主色**，不改数据模型/铁律/分层——那些是可复用价值最高的部分。

---

## 一、必改清单（漏一项 → 上线必炸）

### 1. 站点域名（决定 SEO/canonical/sitemap/robots/OG）

**单一真源已抽好（2026-10-21 核对代码）**：`packages/core/src/site.ts` 的三个常量 —— `SITE_ORIGIN`（scheme+host）/ `SITE_NAME`（品牌名）/ `MEDIA_PUBLIC_BASE`（图床基址，`media.ts` 由它拼 URL）。前台 `layout.tsx` 的 `metadataBase`+title 模板+og:site_name、`page.tsx` 的 WebSite/Organization JSON-LD、`sitemap.ts`、`robots.ts`、`products|categories|brands/[slug]` 的 canonical+OG —— **这 8 个文件全部从它派生**，换域名只改 `site.ts` 一处：

```powershell
# 先看 site.ts 之外还剩哪些真品牌字面量（排除 @onestarry/* 包名导入）
rg -n "(?<!@)onestarry[\w.-]*" apps packages --glob '!cloudflare-env.d.ts'
```

**2026-10-21 已收口（模板待办 T1 已做完）**：下面前五类文案已全部改为从 `SITE_NAME` 派生，**换皮时不用手改**；只剩“基础设施命名”三类仍需人工改（它们故意不经 `site.ts`）：

| 文件 | 现值 | 处置 |
|---|---|---|
| `apps/admin/app/layout.tsx` | `title` / `description` | ✅ 已改为 `${SITE_NAME} · Admin` / `${SITE_NAME} 管理后台`，不用手改 |
| `apps/admin/components/AdminSideNav.tsx` | 侧栏品牌字 | ✅ 已用 `{SITE_NAME}` |
| `apps/web/app/search/page.tsx` | 描述文案 | ✅ 已用 `${SITE_NAME}` |
| `apps/web/components/SiteFooter.tsx` / `SiteHeader.tsx` | 页脚 © 与顶栏品牌字 | ✅ 已用 `{SITE_NAME}` |
| `packages/auth/src/index.ts` | `appName`×2（**auth 发出的邮件里会用**） | ✅ 已用 `SITE_NAME` / `` `${SITE_NAME}-admin` `` |
| `apps/{web,admin,jobs}/wrangler.jsonc` | `name` / `bucket_name` / `services[].service` | ⚠️ **仍需手改**（Worker 与桶命名），见下面 §2/§3 |
| `apps/{web,admin}/app/api/health/route.ts`、`apps/jobs/index.ts` | `service: "onestarry-web" / "onestarry-admin" / "onestarry-jobs"` | ⚠️ **仍需手改**：这是**部署标识不是品牌文案**，改了要跟 Worker 名同步（否则监控对不上号） |
| `apps/admin/lib/importProviders.ts` | 抓取 UA `onestarry-import/1.0` | 可选（对外可见的标识，建议跟着品牌改） |

> 历史注：本节旧版本列过一张「`SITE` 常量散在 9 个前台文件、建议顺手重构」的批量替换表。该重构**已经做完**（统一到 `site.ts`），再照旧表做全局 replace 会误伤无关文件。详见 `docs/IMPLEMENTATION.md` §12.1 T1/T2。

### 2. Cloudflare Worker 名（`wrangler.jsonc` 里的 `name`）

| 文件 | 字段 | 现值 | 建议改法 |
|---|---|---|---|
| `apps/web/wrangler.jsonc` | `name` | `onestarry-com` | `newshop-io`（域名点换横线） |
| `apps/web/wrangler.jsonc` | `services[0].service` | `onestarry-com` | 同上一致（自引用） |
| `apps/admin/wrangler.jsonc` | `name` | `onestarry-admin` | `newshop-admin` |
| `apps/jobs/wrangler.jsonc` | `name` | `onestarry-jobs` | `newshop-jobs` |

### 3. R2 桶名（`wrangler.jsonc` 里的 `bucket_name`）

- `apps/web/wrangler.jsonc` `r2_buckets[0].bucket_name`：`onestarry-media` → `newshop-media`（**自定义域绑定也要跟着在 Cloudflare 后台搬**：R2 Bucket Domains 里把 `cdn.newshop.io` 指向新桶）
- `apps/web/wrangler.jsonc` `r2_buckets[1].bucket_name`：`onestarry-isr-cache` → `newshop-isr-cache`
- `apps/admin/wrangler.jsonc` 的 `MEDIA` binding 同 web 一致
- **实际桶要在 Cloudflare 后台先创建**（R2 → Create bucket），wrangler 只声明绑定

### 3.5 D1 Tag Cache 库（`apps/web/wrangler.jsonc` 的 `d1_databases`）

按需失效（`revalidatePath`）的落地处。换站要新建一个 D1，把 `database_id` / `database_name` 填进 web 的 `wrangler.jsonc`：

```powershell
npx wrangler d1 create newshop-tag-cache
# 建表（在 apps/web 目录下跑；--local 那份供本地 preview，缺也不报错）
npx wrangler d1 execute newshop-tag-cache --remote --file ./d1/revalidations.sql
```

- ⚠ **漏建不报错，只静默空转**：没有 D1 绑定时 `D1NextModeTagCache.getConfig()` 判 `isDisabled`、`hasBeenRevalidated()` 恒 `false`
  → 后台改完前台叫不动（根因见 `docs/PERF.md` §7）。表结构直接用仓库里那份，不要自己改约束：
  上游 `writeTags()` 用的是不带 `ON CONFLICT` 的裸 INSERT，必须是 `UNIQUE(tag) ON CONFLICT REPLACE`，否则二次失效会抛异常。
- 这张表**不放进 `packages/db`**：那里只负责 Neon 的迁移，D1 是另一个引擎；混一起会让“从零部署”的清单裂成两半。

### 4. Hyperdrive ID 与 origin

`apps/{web,admin,jobs}/wrangler.jsonc` 的 `hyperdrive[0].id` 是**具体实例 UUID**（`797e790c...`），换站要新建一个 Hyperdrive：
- Cloudflare → Hyperdrive → Create：**Origin** 指向**新的 Neon project**（host 必须 `-pooler`，见记忆《Hyperdrive 连接 Neon 直连端点导致连接耗尽》）
- 复制新 Hyperdrive 的 **ID** 填到三个 `wrangler.jsonc`
- 若已跑过角色分离（`0015_app_role.sql`），新库同样先建 `app_rw`、再让 Hyperdrive 用它

### 5. Durable Objects migration tag

`apps/web/wrangler.jsonc` 的 `durable_objects` / `migrations` 用的是 OpenNext 内部类名 `DOQueueHandler`，**class_name 保持不变**；`migrations[0].tag` 保持 `v1`（新项目首次部署）。

---

## 二、可选（视品牌需要）

### 6. npm 包作用域 `@onestarry/*`

`packages/*/package.json` 的 `name` 字段与 apps 里的 `import ... from "@onestarry/db"`。要不要改看团队习惯：

- **不改也完全能跑**：作用域 `@onestarry` 只出现在本地 `workspace:*`，不发布到 npm，对新公司不构成任何法务/品牌问题。
- **要改**：一次批量替换 `"@onestarry/` → `"@newshop/` 覆盖所有 `*.ts/*.tsx/*.json`（含 `apps/web/next.config.ts` 的 `transpilePackages`）。用 IDE 全局替换最稳。

**根 `package.json` 的 `name`**：`onestarry-ecommerce-template` → 新仓库名。同样纯装饰。

### 7. 品牌色 / 字体

- **主色**：`packages/ui/src/styles.css` 里 `--color-brand: #111827` / `--color-accent: #2563eb`（当前是深灰 + 蓝）。所有 `<Button>`、`text-brand`、`bg-brand`、`focus:border-accent` 都从这里派生。**改这两个变量即全站换肤**，无需动组件。
- **字体**：`apps/web/app/layout.tsx` 里 Next 内置 `Inter`（如你看到的是）。换成别的 Google Font / 系统栈在 layout 的 font loader 那一行。
- **Logo**：目前导航是纯文字（前台 `SiteHeader` / 后台 `AdminSideNav` 里的字符串）。要图 → 放 `apps/web/public/logo.svg` 并改 `SiteHeader.tsx`。

### 8. Seed 数据

`packages/db/src/seed-catalog.ts` 里的 `drinkware` / `bags` / `stoneware-co` / `trailkit` 与 `seed-demo.ts` 里 3 个 SKU 是**示例目录树**。

- 换品类：把这两个文件的常量数组改成新品牌的首批类目/品牌/商品，跑 `pnpm seed:all` 即可（幂等）。
- 完全空库跑：删掉 `pnpm seed:all` 步骤里的 `seed:catalog && seed:demo`，只留 `seed:ledger`（**账本科目不能不种**，见记忆《新部署法人必须预置账本科目》）。

### 9. 法律文档正文

后台 `/legal`（`apps/admin/app/legal/page.tsx`）里四类：`terms / privacy / returns / withdrawal` 是**纯文本正文**，从 `legal_documents` 表读。新品牌上线前**必须重写**（GDPR/CCPA/14 天撤回权/关税条款因主体而异）。模板里默认是空 → 前台显示占位。

### 10. 管理员种子邮箱

- `.env.local` 里 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 换成真实值。
- 若要改 `apps/admin/scripts/seed-admin.ts` 里 fallback `admin@onestarry.test` 也一并换（现在只作文档展示）。

---

## 三、Cloudflare / Neon 侧要新建的资源

| 资源 | 建在哪 | 备注 |
|---|---|---|
| Neon project | neon.new | 建议同区 US-East；开 PITR；跑 `pnpm db:migrate && pnpm db:partition` |
| Hyperdrive | Workers & Pages → Hyperdrive | origin 指新 Neon 池化端点 |
| R2 `newshop-media`（公开） | R2 → Create bucket | 绑自定义域 `cdn.newshop.io`（DNS 走 CF） |
| R2 `newshop-isr-cache`（私有） | R2 → Create bucket | **不绑公开域**（ISR 快照，仅 Worker 读写） |
| Workers Builds 项目 ×3 | Workers & Pages → Create → Import from Git | 见根 README §部署 |
| Durable Object namespace | 首次 `wrangler deploy` 自动创建（class 名在 wrangler.jsonc） | 无需手工 |
| Cron trigger | `apps/jobs/wrangler.jsonc` 里 `triggers.crons=["* * * * *"]`，随 deploy 生效 | 无需手工 |
| Bulk Redirects 列表（可选） | Workers & Pages → Bulk Redirects | 换皮一般不需要，除非要继承旧域名跳转 |
| Transform Rules（安全头） | 已在 `next.config.ts headers()`，不用 CF 侧再配 | — |

---

## 四、验证换皮是否彻底（跑一遍）

```powershell
# 1) 残留旧品牌字面量扫描
rg -n "onestarry|media\.onestarry\.com" apps packages README.md .env.example --glob '!*.test.*'
# 期望：只剩你有意保留的历史注释/文档；否则回去改

# 2) 本地起前端 + 后台
pnpm install
cp .env.example .env.local    # 填新值
pnpm db:migrate
pnpm db:partition
pnpm seed:all
pnpm dev                      # 打开 http://localhost:3000 看品牌/域名渲染
```

部署前最后一次预检：
- `.env.local` 不进 git（`.gitignore` 已含）
- `apps/*/wrangler.jsonc` 里的 `id`/`bucket_name`/`name` **都改到新值**
- Workers Builds 项目 Secrets：`DATABASE_URL`（池化、**不带引号**，见记忆《Cloudflare Build Secret 中 DATABASE_URL 的值格式规范》）、`BETTER_AUTH_SECRET`

---

## 五、常见坑

- **只改了 `wrangler.jsonc` 的 `name`、没建新 Worker** → `wrangler deploy` 会创建同名新 Worker，但 Workers Builds 项目还连在旧 Worker 上，push 不动 → 手工删掉旧 Workers Builds 项目再新建指向新 Worker 名。
- **只改了域名常量、没改 R2 自定义域** → 商品图 404。R2 Bucket Domains 里把新域名指向新 `*-media` 桶；DNS CNAME 经 Cloudflare 打开代理。
- **改了 Hyperdrive ID 但没建新 Hyperdrive** → 本地 `wrangler dev` 因用 `localConnectionString` 正常、上线 500。ID 必须是 Cloudflare 侧存在的实例。
- **`next.config.ts` 的 `transpilePackages` 里包名忘了同步改** → 若改了包作用域 `@onestarry/*` 而这里没跟着改，`next build` 找不到 workspace 包。
- **新站没建 D1 tag-cache 库** → 按需失效变成静默空动作：不报错、内容也照旧对，`/status` 与 ISR 探针看不出区别（探针只判 HIT/STALE 形状，不判失效是否落地）。要发现只能拿一条构建期预渲染的路由做一次后台保存 + 连打穿透边缘。见 §3.5。
- **账本科目没在新库重跑 `seed:ledger`** → 收款/发货落账全部失败，报错在 `ledger_entries` 找不到科目。见记忆《新部署法人必须预置账本科目》。

---

## 六、不建议动的东西（换皮时勿动）

- **数据模型 / schema**：v13 冻结的表结构与关系是模板核心资产，改了就失去复用性。要加字段走 expand 迁移，别改列名/删列。
- **`slugs` 表 + `resolveSlug` 单一真源**：见记忆《Slug 单一真源》与《URL 重定向决策》。
- **`seo_meta` 稀疏回退**：见 §7 SEO 面板设计。
- **ISR / R2 缓存 / Hyperdrive 三层缓存架构**：见记忆《电商前台缓存最终落地：B-1+B-2+C》。
- **只追加表 `ledger_entries` / `stock_movements` 分区**：见 §15.1‑3。
- **`orders` 域分区阈值**：10M 以内不分，见 §15.1‑3 决策。
- **业务分层**：`apps → packages` 单向依赖、queries 唯一写库出口，见记忆《基于 Turborepo 的电商模板分层模块化单体结构》。

如果你**想**动上面这些 —— 那不是换皮、是 fork 分叉，建议起第二个仓库独立演进。
