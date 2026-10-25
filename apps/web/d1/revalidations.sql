-- OpenNext Tag Cache（D1）—— 按需失效 revalidatePath / revalidateTag 的落地处
--
-- 为什么需要它：`@opennextjs/cloudflare` 的缓存由三个部件组成 —— Incremental Cache（成品）、
-- Queue（调度时间到期刷新）、**Tag Cache（专管 on-demand 失效）**。缺第三个时
-- `D1NextModeTagCache.getConfig()` 判定 isDisabled，`hasBeenRevalidated()` 恒返回 false，
-- 于是 `revalidatePath` 变成静默空动作 —— 这正是 docs/PERF.md §7 里
-- 「构建期预渲染的条目对 revalidatePath 免疫」那条怪事的根因（不是 Next 的毛病，是少装部件）。
--
-- 为什么约束必须是 `UNIQUE(tag) ON CONFLICT REPLACE`（2026-10-25 实测钉死，不是照抄文档）：
--   上游 `writeTags()` 用的是**不带 ON CONFLICT 的裸 INSERT**（见
--   @opennextjs/cloudflare/dist/api/overrides/tag-cache/d1-next-tag-cache.js:62）。
--   同一 tag 二次失效时：
--     · 若写 PRIMARY KEY / UNIQUE 不带冲突策略 → 抛 SQLITE_CONSTRAINT，会把后台保存那条
--       waitUntil 链路上的失效调用变成未捕获异常；
--     · 若不建任何约束 → 行无限堆积，而读路径 `new Map(rows.map(...))` 依赖返回顺序取最新，
--       没有 ORDER BY 的情况下这是运气；
--     · `ON CONFLICT REPLACE` → 裸 INSERT 直接覆盖旧行，表不膨胀且「最新」有保证。
--   验证：建表后连插同一 tag 两次（revalidatedAt 1000 → 2000），结果 rows_total=2（另一 tag 占一行）
--   且存活行的 revalidatedAt=2000 —— 无异常、最新覆盖，两条都符合预期。
--
-- tag 里带 buildId（getCacheKey = `${buildId}/${tag}`）→ 每次部署天然是新键空间，
-- 旧 build 的行不影响新 build，只是会留在表里；本站体量下可忽略，需要时按前缀删。
--
-- 用法（远程与本地各跑一次；本地缺失时 tagCache 会静默 no-op，不影响开发）：
--   npx wrangler d1 execute onestarry-tag-cache --remote --file ./d1/revalidations.sql
--   npx wrangler d1 execute onestarry-tag-cache --local  --file ./d1/revalidations.sql

CREATE TABLE IF NOT EXISTS revalidations (
    tag TEXT NOT NULL,
    revalidatedAt INTEGER NOT NULL,
    stale INTEGER,
    expire INTEGER,
    UNIQUE (tag) ON CONFLICT REPLACE
);
