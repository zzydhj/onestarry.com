# onestarry — 全球电商模板

纯海外、自营单卖家、多品类、单一自有库存、中国仓直发的**可复用电商模板**。架构与设计见 [`全球电商模板-架构方案-交叉验证版.md`](./全球电商模板-架构方案-交叉验证版.md)（v13 冻结）。

> 想以此为起点改造成别的站？看 [`docs/REBRAND.md`](./docs/REBRAND.md)。
> 想知道**代码真实现状 / 还欠什么**？看 [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md)（实现地图；§9 未接线清单、§10 偏差登记、**§12 模板完备性体检**）。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前台/后台 | Next.js 15（App Router + RSC + Server Actions）+ OpenNext on Cloudflare Workers ⚠️ **Next 主版本只维护 2 年**：15.x 的支持窗于 2026-10-21 已过，OpenNext 构建会因此 `exit 1`；升版规则与待办见 `docs/IMPLEMENTATION.md` §12.4（T17–T20） |
| 数据 | Neon PostgreSQL（US-East，池化端点 + Hyperdrive）+ Drizzle ORM |
| 认证 | Better Auth（双实例：customer / admin） |
| 存储 | Cloudflare R2（媒体 + ISR 整页缓存） |
| 队列/定时 | Durable Objects Queue + Cloudflare Cron（`* * * * *`） |
| 边缘 | Cloudflare Workers Builds（Git CI）+ Bulk Redirects + Transform Rules |
| Monorepo | pnpm workspace + Turborepo |

## 目录

```
apps/
  web/         # 前台（Next.js，Workers 部署）
  admin/       # 后台（Next.js，Workers 部署）
  jobs/        # Cron relay（价格扫尾、每分钟）
packages/
  db/          # Drizzle schema / 迁移 / queries（唯一写库出口）
  auth/        # Better Auth 工厂
  core/        # 共享原语（UUIDv7、错误、类型）
  shared/      # 业务常量/枚举
  ui/          # 共享 UI 组件（Tailwind v4）
  jobs/        # relay 逻辑（Worker 与脚本共用）
  config/      # tsconfig / eslint 共享配置
```

---

## 本地跑起来

**前置**：Node ≥20、pnpm 9.15+、一个 Neon project、一个 Cloudflare account（Hyperdrive + 2 个 R2 + Durable Object）。

```bash
# 1. 装依赖
pnpm install

# 2. 配环境变量（把 .env.example 复制到 .env.local，按注释填）
cp .env.example .env.local
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/admin/.dev.vars.example apps/admin/.dev.vars
cp apps/jobs/.dev.vars.example apps/jobs/.dev.vars

# 3. 迁移到 Neon（用 DATABASE_URL_UNPOOLED 直连）
pnpm db:generate    # schema 改了才需要
pnpm db:migrate     # 应用 0001..00NN
pnpm db:partition   # 把 ledger_entries / stock_movements 重建为月分区（幂等）

# 4. 种子（首次必跑；重复跑幂等）
pnpm seed:all     # 依次跑 ledger → catalog → demo → admin
# 超管邮箱/密码来自 .env.local 的 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD（首次拷贝后请改）

# 5. 本地起 web/admin/jobs
pnpm dev
# 前台 http://localhost:3000，后台 http://localhost:3001
```

## 部署（首次）

前台/后台/jobs 各建一个 Cloudflare Workers Builds 项目连本仓库（详见架构 §15.1‑1 与本仓库 `apps/*/wrangler.jsonc`）：

| Worker | Root directory | Framework preset | Build command | Deploy command |
|---|---|---|---|---|
| `onestarry-com`（web） | `/` | None | `pnpm install --frozen-lockfile && pnpm --filter @onestarry/web build` | `pnpm --filter @onestarry/web exec wrangler deploy` |
| `onestarry-admin` | `/` | None | `pnpm install --frozen-lockfile && pnpm --filter @onestarry/admin build` | `pnpm --filter @onestarry/admin exec wrangler deploy` |
| `onestarry-jobs` | `/` | None | `pnpm install --frozen-lockfile` | `pnpm --filter @onestarry/jobs-worker exec wrangler deploy` |

Workers Builds 环境变量（**Variables and Secrets → Secrets**）：

- `DATABASE_URL`：**Neon 池化端点**（host 含 `-pooler`），构建期用于 ISR 预渲染。**值不要带引号**（血泪：带引号 → 28P01 认证失败）。
- `BETTER_AUTH_SECRET`：admin 与 web 各一个（32 字节 base64）。

> ⚠️ **本表待核对（T3）**：上列 Build command 写的是 `next build`，但 `wrangler.jsonc` 的 `main` 指 `.open-next/worker.js` —— 该目录只有 `opennextjs-cloudflare build` 才产出（即 `pnpm --filter @onestarry/web deploy` 的前半段）。站点确实能 push 即部署 ⇒ **Dashboard 里的真实命令与本表不一致**，请从 Workers Builds 项目抄回实际命令再修正本表。另：闸门在 `opennextjs-cloudflare build` 的**第一步**，因此部署路径必过（见 §12.4）。

Hyperdrive / R2 / Durable Object 都在 `wrangler.jsonc` 声明，不用 secret。

---

## 常见坑（新人先看这几条）

- **Hyperdrive 的 Host 必须是池化端点**（含 `-pooler`）；直连端点在 Workers 免费/低并发下会挂起 → 500/1101。见记忆《Hyperdrive 连接 Neon 直连端点导致连接耗尽》。
- **ISR 页 `Cache-Control: s-maxage` 是剩余新鲜度倒计时**：接近过期时看到 `s-maxage=2` 属正常，别误判为缓存回归。验证法：连打同一 URL 观察 `STALE → 回跳满值 → 递减`。
- **改 slug 用 `slugs` 表 + `resolveSlug`**：历史自动 301，不要写 middleware 查 `url_redirects`（会伤 ISR）。旧链接重定向按需走 **Cloudflare Bulk Redirects**（边缘、零每请求开销）。
- **安全响应头不加 CSP**：需要 nonce/strict-dynamic，易与 Next 水合冲突。当前只加 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy` / HSTS。
- **迁移用 `DATABASE_URL_UNPOOLED`（直连）**，运行时用 Hyperdrive（池化）。角色分离后：DDL 走 `neondb_owner`、应用走 `app_rw`（见 `packages/db/drizzle/manual/0015_app_role.sql`）。
- **账本科目必须先种**：`seed:ledger` 不在每个新法人上跑一遍，落账必失败。见架构 §5 与记忆《新部署法人必须预置账本科目》。

## 常用脚本

```bash
pnpm -r typecheck          # 全 workspace 类型检查
pnpm --filter @onestarry/db db:studio    # Drizzle Studio 看库
pnpm --filter @onestarry/db smoke        # 冒烟测试（各模块 smoke:* 见 packages/db/package.json）
pnpm --filter @onestarry/web cf-typegen  # 重生 Workers env 类型
```

## 版本与冻结

- **架构方案**：v13 冻结（2026-Q3），改动需在 §15.1 记施工尾巴。
- **表占位策略**：MVP 建设期（步骤 3–14）一次建全，Phase B/C 通过 expand 迁移加表属正常演进。
