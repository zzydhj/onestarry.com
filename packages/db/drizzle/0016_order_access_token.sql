-- 0016_order_access_token.sql —— 订单访问凭证 + PayPal 订单 id + 存量旧单加固。
--
-- drizzle 生成的是 `ADD COLUMN "public_token" text NOT NULL`，在有存量行的库上会**直接失败**，
-- 所以这里改成标准三步：加可空列 → 回填 → 再设 NOT NULL。schema 里的声明仍是 notNull（下一步
-- `SET NOT NULL` 做完就一致了），别让下一个人以为这列可以空着。
--
-- 顺带做两件 2026-10-23 审查留下的收尾：
--   ① 存量单号随机段只有 3 位（46,656 空间）→ 重排成 8 位；
--   ② 存量单没有访问凭证 → 补一条。
-- 回填的随机值用 `gen_random_uuid()` 派生（Postgres 核心自带，不赌 pgcrypto 是否装过）：
-- 22 个 hex 字符 ≈ 88 bit、8 位 hex ≈ 32 bit，**对这几条 demo 存量数据足够**；
-- 新单走应用层的 128 bit / 41 bit 生成器（core/orderNumber，带单测）。

ALTER TABLE "orders" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paypal_order_id" text;--> statement-breakpoint

-- ② 回填凭证（只补没有的，可重复运行）
UPDATE "orders"
SET "public_token" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 22)
WHERE "public_token" IS NULL;--> statement-breakpoint

-- ① 存量 3 位后缀的单号重排成 8 位（保留原时间前缀，客服对单习惯不变）
UPDATE "orders"
SET "order_number" = split_part("order_number", '-', 1) || '-' || split_part("order_number", '-', 2) || '-' ||
                     upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE "order_number" ~ '^SO-[0-9A-Z]{1,10}-[0-9A-Z]{3}$';--> statement-breakpoint

ALTER TABLE "orders" ALTER COLUMN "public_token" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "order_public_token_uq" ON "orders" USING btree ("public_token");
