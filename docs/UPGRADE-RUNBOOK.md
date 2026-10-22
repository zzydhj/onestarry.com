# UPGRADE-RUNBOOK — 依赖升级与发版操作清单

> 适用：Next 主版本（16→17）、`@opennextjs/*`、`wrangler`、Drizzle/迁移、以及任何会动到构建产物的依赖升级。
> 用法：**从上到下逐项做完再进下一项**，任何一步不通过就停在原地，不要"先跳过去继续"。
> 触发时机：后台导航条亮起黄条（到期前 180 天，见 `packages/core/src/maintenance.ts` 的 `ACTION_LEAD_DAYS`），或 `pnpm deps:window` 提示 warn。

---

## 0. 先记住四条会救命的认知

| 认知 | 为什么 |
|---|---|
| **部署失败 ≠ 现网挂** | Workers 保留历史版本；构建失败只是"新代码没上去"，线上继续跑上一个成功版本。**别在慌的时候改代码**，先看构建日志 |
| **真风险是"坏版本一上线就 100% 接手"** | 默认部署是全量原子切换，不灰度 → 所以第 6 步的放量不可跳过 |
| **回滚不需要重新构建** | 控制台 Workers → 你的 Worker → **Versions** → 把上一个版本调到 100%，秒级生效 |
| **缓存的坏法是无声的，build 全绿不算过关** | 缓存 miss 永远合法 —— 不报错、不告警、内容也对，只是每次访问都多付一次跨洋渲染。2026-10-22 的事故就长在 Next 15→16 升级的第二天早上（`4ec2c21` → 次日 `09aa1f1`）：构建全绿、页面全对，但商品页 ISR 永不命中。所以第 4 步的路由表与第 6 步的 verdict **两项都不可跳**，判读法见 docs/PERF.md §3/§6/§7 |

---

## 1. 选窗口（发版前）

- [ ] 时间：**北京时间上午 09:00–11:30**（本站纯欧美市场，此时是美东 21:00–23:30 深夜低峰）。**绝对避开北京时间 20:00–次日 08:00**（美国白天全高峰）
- [ ] 登录后台看概览页运维面板：**outbox 待办/失败应为 0**，「最老待办」没有在持续增长（有积压说明流水线正忙，此时发版会让改价/库存不生效，问题难归因）
- [ ] 确认 `pnpm deps:window` 当前输出（记下 Next 支持截止日，验证升级方向正确）

```powershell
pnpm deps:window          # warn-only，看剩余天数与 wrangler 要求
```

---

## 2. 开分支，禁止直接改 main

```powershell
git checkout -b chore/deps-<主题>     # 例：chore/next-17
```

- [ ] 分支推上去后，**Cloudflare 的"非生产分支构建"会自动构建它**（已启用）→ 这就是 Linux 真实构建环境的预演，本地通过不算数
- [ ] 注意：分支构建的 Deploy 命令若配置为生产 Worker，会直接覆盖线上 → **确认 Dashboard 里"生产分支"只有 main**（否则本步骤只观察构建产物、不要让分支执行 deploy）

---

## 3. 改版本（一次只做"依赖对齐"这一件事）

- [ ] 只改版本号，**不动业务代码**（这样一旦构建红，责任范围明确）
- [ ] 需要一起动的地方：`apps/{web,admin}/package.json` 的 `next`、三处的 `wrangler`、根 `package.json` 的 `engines.node`
- [ ] 若 Next ≥ 16.1 → `wrangler` 必须 ≥ `4.59.2`（OpenNext 的 `ensureNextjsVersionSupported` 会检查）

```powershell
pnpm install
pnpm deps:window          # 立刻确认新组合在支持窗内
```

**⚠️ 反直觉的坑**：`@opennextjs/aws` 的 `NEXT_RELEASE_DATES` 表里**没有登记的主版本会被直接判为"不支持"**。所以"装个更新的 Next"不自动过关 —— 必须同时有支持它的 OpenNext 版本。

---

## 4. 本地四道验证（全绿才继续）

```powershell
pnpm typecheck            # 期望 8/8
pnpm test                 # 期望全过（当前 43）
cd apps/admin;  npx --no-install next build
cd ..\web;  $env:DATABASE_URL=(Get-Content ..\..\.env.local | Select-String '^\s*DATABASE_URL=').ToString().Split('=',2)[1].Trim().Trim('"'); npx --no-install next build
```

- [ ] web 构建需要 `DATABASE_URL`（首页/PDP 构建期连真库预渲染，**这是设计如此**，不是 bug）
- [ ] 两站 build 都要看**路由表**：原本 `●`（SSG/ISR）的页不能莫名变成 `ƒ`（Dynamic）—— 那意味着缓存失效，客户会变慢（判读 `s-maxage` 时注意它是**剩余新鲜度倒计时**，接近过期看到小值属正常）
- [ ] **新增的公开读页必须同时有 `generateStaticParams`**：没有它 = 走“按需 ISR” = 运行时 `set()` 写的条目被判即时过期 → 恒 `STALE` 且不带 `Cache-Control`（零缓存收益，不报错）。升级后重看一遍路由表，确认该预渲染的页仍在列（docs/PERF.md §7）
- [ ] 若 Next 升级带来破坏性变更，本项目历史命中面（照此复查）：`params`/`searchParams`/`cookies()`/`headers()` 是否仍 `Promise`+`await`；有无 `opengraph-image`/`icon` 文件；`sitemap` 是否用了 `id`；是否有自定义 `webpack`；是否残留 `next lint`

---

## 5. 若涉及数据库迁移（Next 升级本身不涉及）

- [ ] **先在 Neon 分支上跑迁移**（Neon Dashboard → Branches，或 `neon branch`），确认 SQL 与回滚脚本
- [ ] 生产执行前：记录当前 PITR 恢复点；确认 `app_rw` 角色权限对新表已 GRANT（`0015_app_role.sql` 的约定）
- [ ] ⚠️ 已知陷阱：**postgres-js 对聚合表达式（`min()`/`max()`）返回文本而非 Date**，`sql<Date>` 标注会骗过 typecheck、运行时才崩 → 时间字段必须过一层归一函数（参考 `packages/db/src/queries/outbox.ts` 的 `toDate`）

---

## 6. 部署与放量（不可跳过）

- [ ] 合到 main（或按你的 CI 约定触发构建），等构建完成
- [ ] **用 `/api/health` 确证线上版本**（这是它存在的唯一目的）：

```powershell
curl.exe -s https://admin.onestarry.com/api/health   # 看 gitSha 是否 = 你刚推的提交
curl.exe -s https://onestarry.com/api/health
```

- [ ] Cloudflare 控制台 → Worker → **Versions** → 新版本先给 **5%** → 观察 5–10 分钟
- [ ] **ISR 健度确证（升级后必做，这是本次事故的直接产物）**：`/api/health` 的 `isr.verdict` 必须是 `ok`（`badStreak: 0`），再跑一轮主动测量：

```powershell
powershell -NoProfile -File scripts/isr-watch.ps1 -Rounds 3 -GapSeconds 15
# 健度形状：HIT + s-maxage 倒计时 → 到期那一发 STALE → 下一发回到满值
# 坏形状：同一 colo 里 HIT/STALE 振荡，或恒 STALE 且无 Cache-Control（先排探针被边缘接住）
```
- [ ] 观察项：`/api/health` 200；首页/PDP 正常出图与价格；后台能登录、概览/商品/订单三页能打开；Workers 日志无新增 error；outbox 待办不增长
- [ ] 通过则 25% → 100%；**任何异常立刻把权重调回上一版本**（秒级，不用重新构建），再排查

---

## 7. 收尾

- [ ] 更新 `packages/core/src/maintenance.ts`：`DECLARED_NEXT_MAJOR`、`NEXT_MAJOR_RELEASE_DATES`（新主版本的发布日）、必要时 `WRANGLER_MIN_FOR_NEXT_*`
- [ ] 跑 `pnpm deps:window --strict` 确认无 warn（`compat_date` 若被提示过旧，同步三处 `wrangler.jsonc`）
- [ ] 文档三处同步：`docs/IMPLEMENTATION.md` §12（对应 T 项状态）、架构方案 §15.2、`README.md` 技术栈行
- [ ] 打 tag 便于回滚定位：`git tag deps-YYYYMMDD-<主题>`

---

## 8. 回滚预案（出事时按顺序做）

1. **版本回滚**：Workers → Versions → 上一版本 100%（最快，秒级，不需要构建）
2. **确认回滚生效**：`curl https://admin.onestarry.com/api/health` 看 `gitSha` 变回旧值
3. **数据侧**：只有做过迁移才需要 —— Neon 控制台 Restore/PITR 到迁移前时间点（见 `docs/DR-RUNBOOK.md` 场景 A）
4. 事后：把根因写进 `docs/IMPLEMENTATION.md` §12 对应 T 项或新登记一条 D 项，别只记在脑子里

---

## 9. 明确不要做的事（都试过或查过）

- ❌ **永久加 `--dangerouslyUseUnsupportedNextVersion`**：那是过桥用的，长期用等于把官方支持窗的风险转嫁给自己（未登记主版本、无安全补丁）
- ❌ `patch-package` 改 OpenNext 的日期表：每次升级都要重打补丁，且绕过的是"官方不再修这个版本"的真实信号
- ❌ 为了升级顺手重构业务代码：两件事混在一个构建里，红了分不清是谁的锅
- ❌ 跳过第 6 步直接 100%：这是唯一能造成"全站同时坏"的动作
