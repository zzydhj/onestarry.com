-- 0016_role_timeouts.sql —— 给角色配三根"保险丝"，让库能自愈，不再依赖手动重启 compute。
--
-- 背景（2026-10-29 复盘）：本仓此前**从未设过**任何超时，三个 GUC 全为 Postgres 默认 0（=永不超时）：
--   ① lock_timeout=0：DDL/DCL 抢不到锁就无限排队；而排队中的 ACCESS EXCLUSIVE 请求会**挡住该表后续所有读写**
--      （连 SELECT 都得排在它后面）→ 请求堆积 → 连接槽占满 → 整台 compute 对外失联。
--   ② idle_in_transaction_session_timeout=0：客户端被强杀 / 网络半开时，后端会话**永远留着并继续持锁**（僵尸后端）。
--   ③ 又因为刻意用 cron 保活 compute（PERF 的既定决策，为压冷启动），它**从不因闲置 suspend** →
--      没有自动清会话的机会 → **手动 Restart 成了唯一逃生门**。本文件把"必须人工重启"变成"数据库自己恢复"。
--
-- 作用范围：ALTER ROLE ... SET 只影响**新建会话**。Hyperdrive 会复用池内会话，故应在重启 compute 之后
--   （或让 Hyperdrive 重建连接）再核验生效；本仓惯例是 Neon SQL Editor 以 neondb_owner 执行。
--
-- 取值依据（见 docs/PERF.md 实测：跨洋单页查询 1–5.3s，一次导航固定开销 ~2s）：
--   app_rw 的 statement_timeout 取 30s，是真实最慢读路的 ~6 倍，不会误杀正常请求，又能挡住 runaway。
--   neondb_owner **故意不设 statement_timeout**：迁移/分区维护本就可能长跑，杀它比它卡住更糟；
--     但给它 lock_timeout=15s——这保证"维护操作排队等锁"最多 15 秒就让路，不再拖垮整库。

-- 1) 运行时角色（Hyperdrive 走这条）：三根全上，任何一条卡住都快速失败、快速回收
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE app_rw SET lock_timeout = '5s';
ALTER ROLE app_rw SET statement_timeout = '30s';

-- 2) 维护/DDL 角色：只加"等锁上限"，不加语句上限（长迁移要能跑完）
ALTER ROLE neondb_owner SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE neondb_owner SET lock_timeout = '15s';

-- 3) 核验（跑完应能读到上面的值）：
--    select rolname, rolconfig from pg_roles where rolname in ('app_rw','neondb_owner');
-- 例外口子：确需长时间等锁的一次性维护，在会话里临时放宽即可，不要改默认值——
--    set lock_timeout = '5min';
