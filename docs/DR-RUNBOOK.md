# DR Runbook · 灾备与恢复手册

> 全球电商模板的备份/恢复操作手册。**上线前必过一遍**（对应架构 §15.2「上线前必核」）。
> 图例：🟩 平台内置、开箱即用 · 🟨 需手动/按需 · 🟥 待自动化（尚未接线，本手册给出接线位置）。

## 1. 资产清单（换皮时同步更新本表）

| 资产 | 标识 | 区域 | 说明 |
|---|---|---|---|
| Neon 主库 | `ep-falling-block-b4x3ise4`（池化端点 `-pooler`） | us-east-2 | 单一真源；应用经 Hyperdrive 以 `app_rw` 连（§15.1‑4） |
| Hyperdrive | `797e790ce60448298d7a5502a6ea15fb` | — | 连接池 + 缓存；Host 指向 `-pooler` |
| R2 媒体桶 | `onestarry-media`（自定义域 `media.onestarry.com`） | — | 商品图/内容图，公开读 |
| R2 缓存桶 | `NEXT_INC_CACHE_R2_BUCKET` | — | Next ISR 整页缓存（丢了可自愈，非持久数据） |
| Durable Object | `NEXT_CACHE_DO_QUEUE` | — | ISR revalidation 队列 |
| Workers | `onestarry-com`（web）· admin Worker · `onestarry-jobs`（Cron） | 全球边缘 | Git CI 自动部署（§15.1‑1） |
| DB 角色 | 应用 `app_rw` / DDL·迁移 `neondb_owner` | — | 见 §5 |

## 2. 备份现状

- 🟩 **Neon PITR（Point-in-Time Recovery）**：主库默认开启，保留窗口按套餐（免费/低档通常 ~7 天，Scale 及以上更长）。可把库**回滚到窗口内任意时间点**或**拉一个该时间点的分支**。这是**第一道、也是最快的恢复手段**。→ 上线前务必在 Neon 控制台确认本项目的实际保留天数（§15.2‑①）。
- 🟨 **`pg_dump` 逻辑备份 → R2**：财税数据需留存 **7–10 年**（远超 PITR 窗口），必须另有冷备。当前**未自动化**，先按下文 §6 手动跑；接线位置见 §7。
- 🟩 **R2 媒体桶**：Cloudflare 内部多副本。跨桶/跨区域冷备如需，另配「R2→R2 复制」或生命周期导出（🟨 按需）。
- 🟥 **ISR 缓存桶 / DO 队列**：非持久业务数据，丢失无需备份——首个请求会重建（最多冷启动慢一次）。

## 3. 恢复场景与步骤

### 场景 A：误删/改坏数据、坏迁移（最常见）
优先用 PITR，**不要**直接在生产库上 `DELETE`/`UPDATE` 救火。
1. Neon 控制台 → 主分支 → **Restore**，选误操作**前**的时间点，**Restore to new branch**（拉新分支，不动生产）。
2. 在新分支上核对被救数据（`psql` 连新分支的 `DATABASE_URL_UNPOOLED`）。
3. 确认无误后二选一：
   - **整库回滚**：把生产分支 reset 到该 PITR 点（会丢该点之后的写入，需评估）。
   - **定点回补**：只把需要的行从救回分支导出、写回生产（`pg_dump -t <table> --data-only` 或手写 upsert）。
4. 坏迁移场景：`drizzle-kit` 迁移文件在 Git 里，回滚代码 + 用 §5 的 owner 连接重放正确迁移。

### 场景 B：整库不可用 / 灾难
1. 若有 PITR：按场景 A 从 PITR 拉分支恢复。
2. 若 PITR 窗口外：用最近的 `pg_dump` 冷备（§6）→ 新建 Neon 分支 → `pg_restore`。
3. 恢复后把 Hyperdrive 指向确认无误的库（§4）。

### 场景 C：某个 Worker 出问题（web/admin/jobs）
- Cloudflare Workers 本身多区域、无需灾备；问题一般是**坏版本**。
- 回滚：Workers 控制台 → 该 Worker → **Versions** → 把上一个健康版本调到 100% 流量。
- 根治：Git revert 坏 commit → push → CI 自动重建部署。

### 场景 D：R2 媒体桶对象丢失
- 少量：从冷备/来源重新上传（后台商品图/内容图重传）。
- 媒体是**可再生但麻烦**的数据——重要原图应在本地/对象冷备另存一份（🟨）。

## 4. Hyperdrive / 连接串体检
- 恢复或换库后，确认 Hyperdrive 的 **Source** 指向正确 Neon endpoint（且 Host 用 `-pooler` 池化端点，勿用直连端点，否则连接耗尽——见既有血泪）。
- 应用侧无需改代码：`getDb()` 运行期读 `env.HYPERDRIVE.connectionString`；构建期回退 `DATABASE_URL`（CI Build Secret，值**不带引号**）。

## 5. 角色分离（恢复时的关键约束）
- 日常应用 = `app_rw`（经 Hyperdrive）。`ledger_entries` / `stock_movements` 对 `app_rw` **禁 UPDATE/DELETE**（只追加，DB 级强制，§15.1‑4）。
- **只有恢复/DDL 才用 `neondb_owner`**（`DATABASE_URL_UNPOOLED`）：跑迁移、建角色、必要时覆盖只追加表的救急回补。
- ⚠️ 救急回补只追加表要三思：破坏 append-only 会动摇账本/库存审计的不可变性，优先「补一条反向流水」而非「改/删旧行」。

## 6. 手动冷备（当前做法）
```bash
# 全库逻辑备份（DDL 走 owner 非池化端点）；-Fc 自定义压缩格式，便于 pg_restore 选择对象
pg_dump "$DATABASE_URL_UNPOOLED" -Fc -f "backup_$(date -u +%Y%m%dT%H%M%SZ).dump"

# 上传到 R2 冷备桶（示例；桶名按实际）
wrangler r2 object put "<backup-bucket>/db/backup_YYYYmmTHHMMZ.dump" --file ./backup_*.dump

# 恢复（到新分支/新库）
pg_restore -d "$TARGET_UNPOOLED" --no-owner --exit "backup_YYYYmmTHHMMZ.dump"
```

## 7. 待自动化（🟥 接线位置）
- **定期 `pg_dump → R2`**：在 `apps/jobs`（`onestarry-jobs` Cron Worker）加一条**每日** cron（如 `20 4 * * *`），与数据保留 job（§15.1 第 6 条 / 计划 5b）同处调度。Worker 内用 owner 连接跑导出并 `env.<BACKUP_BUCKET>.put()`。注意 Worker 不能直接 exec `pg_dump` 二进制——可用 SQL 逻辑导出到 R2，或改由外部定时任务（GitHub Actions 定时 workflow + `pg_dump`）承担，二选一。
- **恢复演练**：每季度做一次 PITR→新分支→抽查，确保手册与权限可用。

## 8. 上线前必核（对齐 §15.2）
- [ ] 确认 Neon PITR 实际保留天数（套餐）。
- [ ] 建立 R2 冷备桶 + 首次 `pg_dump` 归档。
- [ ] 跑通一次 PITR 恢复演练（场景 A）。
- [ ] 确认 `app_rw` 只追加 REVOKE 生效、恢复用 owner 凭据在手。
- [ ] 财税冷备留存策略（7–10 年）落到自动化或外部定时任务。
