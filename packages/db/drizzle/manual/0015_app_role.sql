-- 0015_app_role.sql —— DB 角色分离（最小权限），为模板运行时(Hyperdrive)建低权 app_rw 角色。
--
-- 目的：应用不再以表主 neondb_owner 连库，改用只干该干活的 app_rw；并对只追加表
--       ledger_entries / stock_movements 禁掉 UPDATE/DELETE（append-only 由 DB 强制）。
--
-- ⚠️ 安全：本文件含密码占位符，切勿把真实密码提交进仓库。正确做法：
--   1) 把本文件**复制**到临时位置（如 $env:TEMP\0015_run.sql），在副本里把两处 PASTE_STRONG_PASSWORD_HERE 换成强密码。
--   2) 在 Neon「SQL Editor」以 neondb_owner 运行副本内容；跑完删副本。仓库内这份始终保持占位符。
--   3) 到 Cloudflare Hyperdrive，把 origin 的 Database user/password 改成 app_rw / 同一密码。
--   4) 迁移/DDL 仍用表主（DATABASE_URL_UNPOOLED），运行时用 Hyperdrive(app_rw)。
--
-- 已验证（2026-10-20）：本仓库当前实例已完成上述流程，app_rw 在线；ledger/stock 禁 UPDATE/DELETE、outbox 保留 UPDATE。
--
-- 幂等：角色存在则改密；重复授权无害。

-- 1) 低权登录角色
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw LOGIN PASSWORD 'PASTE_STRONG_PASSWORD_HERE';
    ELSE
        ALTER ROLE app_rw WITH LOGIN PASSWORD 'PASTE_STRONG_PASSWORD_HERE';
    END IF;
END $$;

-- 2) 最小权限：schema 使用 + 全表 DML + 全序列（upsert 需 INSERT+UPDATE，均已含）
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

-- 未来新表/序列自动授权（模板会继续加表，避免逐个补权踩坑）
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

-- 3) 只追加表：禁 UPDATE/DELETE（注意 transactional_outbox 不在此列——relay 每分钟要 UPDATE 它）
REVOKE UPDATE, DELETE ON ledger_entries, stock_movements FROM app_rw;
