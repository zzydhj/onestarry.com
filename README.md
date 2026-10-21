# onestarry — 全球电商模板

纯海外、自营单卖家、多品类、单一自有库存、中国仓直发的**可复用电商模板**。架构与设计见 [`全球电商模板-架构方案-交叉验证版.md`](./全球电商模板-架构方案-交叉验证版.md)（v13 冻结）。

> 想以此为起点改造成别的站？看 [`docs/REBRAND.md`](./docs/REBRAND.md)。
> 想知道**代码真实现状 / 还欠什么**？看 [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md)（实现地图；§9 未接线清单、§10 偏差登记、**§12 模板完备性体检**）。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前台/后台 | Next.js 16（App Router + RSC + Server Actions，**Turbopack 默认**）+ OpenNext on Cloudflare Workers ⚠️ **Next 主版本只维护 2 年**：16.4.2 的支持窗到 **2027-10-21**，到期前必须再升一次（机制与待办见 `docs/IMPLEMENTATION.md` §12.4） |
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

**前置**：Node ≥20.9（Next 16 硬性要求）、pnpm 9.15+、一个 Neon project、一个 Cloudflare account（Hyperdrive + 2 个 R2 + Durable Object）。

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

| Worker | Root | Preset | Build command | Deploy command |
|---|---|---|---|---|
| `onestarry-com`（web） | `/` | None | **目标配置**：`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm --filter @onestarry/web run cf:build`（🟡 当前仍为 `... exec opennextjs-cloudflare build`，待改） | `pnpm --filter @onestarry/web exec wrangler deploy` |
| `onestarry-admin` | `/` | None | 同 web 模式，把 `web` 换成 `admin`（❗待你顺手核对一次） | `pnpm --filter @onestarry/admin exec wrangler deploy` |
| `onestarry-jobs` | `/` | None | `pnpm install --frozen-lockfile` | `pnpm --filter @onestarry/jobs-worker exec wrangler deploy` |

另：Workers Builds 的**版本命令**（Preview/本地调试用）web/admin 填 `pnpm --filter @onestarry/<app> exec wrangler dev`；jobs 无。非生产分支构建已勾选 ⇒ 任何分支 push 都会自动跑一次完整构建（生产 Worker 不动），这是升级/重构的第一道回归网；Preview 环境（Set up Worker Previews）未启用。

> ❗ **关键认知（踩过）**：CI 直接调 `exec opennextjs-cloudflare build`，**不走** `package.json` 里的 `deploy` 脚本。所以任何要加给构建的 CLI 参数（如 `--dangerouslyUseUnsupportedNextVersion`）**写在 npm 脚本里对 CI 无效**，必须同时改 Dashboard 命令；建议把构建收进一个 `cf:build` 脚本、Dashboard 只调 `run cf:build`，以后参数增删全在 git 里可审计，Dashboard 不再动。
> 另：`opennextjs-cloudflare build` 的**第一步**就是 Next 版本支持窗校验（见 `docs/IMPLEMENTATION.md` §12.4），它挂了部署就挂。—— 升到 Next 16 后，**旧的 `exec opennextjs-cloudflare build` 也能正常过闸门**，所以改 Dashboard 不再是“不改进不了”的应急项；改它的收益是：把 `typecheck + test` 纳入构建前置（挂了就不部署）+ 让未来任何构建参数的增删都只改仓库脚本、不动 Dashboard。

Workers Builds 环境变量（**Variables and Secrets → Secrets**）：

- `DATABASE_URL`：**Neon 池化端点**（host 含 `-pooler`），构建期用于 ISR 预渲染。**值不要带引号**（血泪：带引号 → 28P01 认证失败）。
- `BETTER_AUTH_SECRET`：admin 与 web 各一个（32 字节 base64）。

> ⚠️ **构建期会连真库**：OpenNext 在构建期预渲染 ISR 页时会用 `DATABASE_URL` 连生产 Neon；secret 值损坏不是降级而是直接构建失败（历史血泪：28P01，见 §12.4 与记忆《Cloudflare Build Secret 中 DATABASE_URL 的值格式规范》）。

> ✅ **过桥 flag 已摘除**（2026-10-21 升到 Next 16.4.2 后）：`cf:build` 现为干净的 `opennextjs-cloudflare build`。历史：Next 15 支持窗于 2026-10-21 过完时，CI 曾在构建第一步 `exit 1`；当时靠 `--dangerouslyUseUnsupportedNextVersion` 过桥。**下次到期前（≈2027-08）请重跑升级而不是永久加 flag**（追踪：`docs/IMPLEMENTATION.md` §12.4/§12.6）。另：`pnpm lint` 目前仍会报错（eslint 从未接通，见 T22），所以**没放进 CI 门禁**。

> **维护节奏（本模板定调）**：不做月度依赖巡检、不装 dependabot。**唯一触发器是后台导航条**：到期前 **180 天亮黄条**（带具体开工日，例 `建议 2027-04-24 前开始升级`）、超窗亮红条，仅 `config:write` 可见；想主动核一遍就跑 `pnpm deps:window`。升级时记住：**部署失败不会让现网挂**（Workers 保留上一版本：新代码上不去，已上线的照跑），真正的风险是“坏版本一上线就 100% 接手”→ 用 **Workers Versions 分阶段放量**（出事秒级把上一版本调回 100%，不重新构建）。发版窗口选**北京时间上午 09:00–11:30**（本站纯欧美市场，此时是美东深夜低峰）。详见架构文档 §15.2 ⑯。

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
pnpm typecheck             # turbo 全仓类型检查（现 8/8 全绿）
pnpm -r typecheck          # 逐包跑（等价）
pnpm test                  # turbo 全仓单测（现 28/28）
pnpm build                 # turbo 全仓构建
pnpm --filter @onestarry/web cf:build   # OpenNext 构建（CI 用的就是它）
pnpm --filter @onestarry/db db:studio    # Drizzle Studio 看库
pnpm --filter @onestarry/db smoke        # 冒烟（连真库写数据，**手动跑**、不进 CI）
pnpm --filter @onestarry/web cf-typegen  # 重生 Workers env 类型
pnpm deps:window          # 依赖支持窗口自检（Next 到期日 / wrangler 要求 / compat_date）
pnpm deps:window --strict # 同上，但超窗/未登记 → 退出 1（发布前硬把关）
```

> ⚠️ `pnpm lint` 暂不可用（各包缺 `eslint.config.mjs` 与 eslint 依赖，详实现地图 §12.2 T22）。

## 版本与冻结

- **授权**：见 [`LICENSE.md`](./LICENSE.md) —— 保留所有权利，**仅供内部项目复用**，不得对外分发。
- **实现现状**：代码做到哪一步、哪里还是占位，一律看 [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md)（含 §12 模板完备性体检 T1–T22）。
- **架构方案**：v13 冻结（2026-Q3），改动需在 §15.1 记施工尾巴。
- **表占位策略**：MVP 建设期（步骤 3–14）一次建全，Phase B/C 通过 expand 迁移加表属正常演进。
