-- 0014_partition_append_only.sql
-- 把两张「纯追加、无入向外键」的事实表重建为按 created_at 的 RANGE 月分区：
--   ledger_entries、stock_movements（涨得最快；只有出向外键，PG12+ 允许分区表持有）。
-- 幂等：已是分区表(relkind='p')则整段跳过。base 迁移(0001–0013)后运行一次；空/小表成本极低。
-- 由 packages/db/scripts/apply-partition.ts 执行（drizzle-kit 无法生成 PARTITION BY，故独立"专门迁移"）。
-- 顺序要点：先建分区父表→灌数据→DROP 旧表（释放索引/约束名）→再加 PK/FK/索引，避免同名冲突。

DO $$
DECLARE
    d      date;
    end_d  date;
    k      "char";
BEGIN
    ------------------------------------------------------------------ ledger_entries
    SELECT c.relkind INTO k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='ledger_entries';
    IF k = 'p' THEN
        RAISE NOTICE 'ledger_entries 已是分区表，跳过';
    ELSE
        ALTER TABLE ledger_entries RENAME TO ledger_entries_legacy;
        CREATE TABLE ledger_entries (LIKE ledger_entries_legacy INCLUDING DEFAULTS) PARTITION BY RANGE (created_at);

        SELECT date_trunc('month', min(created_at))::date INTO d FROM ledger_entries_legacy;
        IF d IS NULL THEN d := date_trunc('month', now())::date; END IF;
        end_d := (date_trunc('month', now()) + interval '12 months')::date;
        WHILE d <= end_d LOOP
            EXECUTE format('CREATE TABLE %I PARTITION OF ledger_entries FOR VALUES FROM (%L) TO (%L)',
                'ledger_entries_' || to_char(d,'YYYYMM'), d, (d + interval '1 month')::date);
            d := (d + interval '1 month')::date;
        END LOOP;
        EXECUTE 'CREATE TABLE ledger_entries_default PARTITION OF ledger_entries DEFAULT';

        EXECUTE 'INSERT INTO ledger_entries SELECT * FROM ledger_entries_legacy';
        DROP TABLE ledger_entries_legacy;

        ALTER TABLE ledger_entries
            ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id, created_at),
            ADD CONSTRAINT le_txn_fk  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id),
            ADD CONSTRAINT le_acct_fk FOREIGN KEY (account_id) REFERENCES ledger_accounts(id);
        CREATE INDEX le_transaction_idx ON ledger_entries (transaction_id);
        CREATE INDEX le_account_idx     ON ledger_entries (account_id);
        RAISE NOTICE 'ledger_entries 已分区';
    END IF;

    ------------------------------------------------------------------ stock_movements
    SELECT c.relkind INTO k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='stock_movements';
    IF k = 'p' THEN
        RAISE NOTICE 'stock_movements 已是分区表，跳过';
    ELSE
        ALTER TABLE stock_movements RENAME TO stock_movements_legacy;
        CREATE TABLE stock_movements (LIKE stock_movements_legacy INCLUDING DEFAULTS) PARTITION BY RANGE (created_at);

        SELECT date_trunc('month', min(created_at))::date INTO d FROM stock_movements_legacy;
        IF d IS NULL THEN d := date_trunc('month', now())::date; END IF;
        end_d := (date_trunc('month', now()) + interval '12 months')::date;
        WHILE d <= end_d LOOP
            EXECUTE format('CREATE TABLE %I PARTITION OF stock_movements FOR VALUES FROM (%L) TO (%L)',
                'stock_movements_' || to_char(d,'YYYYMM'), d, (d + interval '1 month')::date);
            d := (d + interval '1 month')::date;
        END LOOP;
        EXECUTE 'CREATE TABLE stock_movements_default PARTITION OF stock_movements DEFAULT';

        EXECUTE 'INSERT INTO stock_movements SELECT * FROM stock_movements_legacy';
        DROP TABLE stock_movements_legacy;

        ALTER TABLE stock_movements
            ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id, created_at),
            ADD CONSTRAINT sm_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;
        CREATE INDEX sm_variant_idx ON stock_movements (variant_id);
        CREATE INDEX sm_ref_idx     ON stock_movements (reference_type, reference_id);
        RAISE NOTICE 'stock_movements 已分区';
    END IF;
END $$;
