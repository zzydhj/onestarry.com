-- 0017_append_only_hardening.sql —— 把「只追加 / 已开具凭证不可改写」这条不变量补全（审查 M1）
--
-- 三处缺口（均已连库核过，不是推测）：
--   ① 0015 只 REVOKE 了 ledger_entries + stock_movements。`ledger_transactions` 带着
--      reference_type / reference_id（分录 ↔ payment 的对应关系），app_rw 一直可以 UPDATE 它 ——
--      把头改指到别的 id，分录就和那笔钱脱钩：账仍然借贷平衡，看不出来。
--   ② invoices / credit_notes 是**已开具的法务凭证**，同样没进 REVOKE 名单。
--   ③ stock_movements.variant_id 的外键在 manual/0014 里被建成 `ON DELETE CASCADE`：
--      PG 的**级联删除不检查子表权限**，所以 ①对 stock_movements 的 REVOKE（含分区叶）挡不住
--      `DELETE FROM product_variants`（或经 products 的级联）把某个变体的整段库存流水抹掉。
--      ⇒ 光撤权不够，必须把 FK 改成 RESTRICT：有流水的变体删不掉，只能下线。
--
-- 前提已核：全仓 `UPDATE/DELETE` 这四张表 + product_variants 的写路径**零命中**（grep 验证），
-- 所以本文件不改变任何应用行为，纯收紧；改完若有人撞到 42501/23503，那是它在拦本该拦的事。
--
-- 与 M-9 的配合：分区**叶**的 REVOKE 在 manual/0014 末尾那段；一次维护窗口里先 `pnpm db:partition`
-- （回填叶级撤销）再跑本文件，两件事一起收口。
--
-- 幂等：REVOKE 重复执行无害；FK 仅在当前是 CASCADE(confdeltype='c') 时重建，重跑为空操作。
-- 保险丝：本文件所有 DDL 都取 ACCESS EXCLUSIVE，而**排队中的 AE 会挡住该表后续所有读写（连 SELECT）**。
--   所以先 SET LOCAL lock_timeout='3s'：抢不到锁就快速失败退让，绝不把整台 compute 拖到失联
--  （2026-10-29 实际踩过一次，靠重启 compute 才解）。真被挡下就换时段重跑，无需人工干预别的东西。

DO $$
DECLARE
    c         record;
    has_fk    boolean := false;
BEGIN
    SET LOCAL lock_timeout = '3s';

    ------------------------------------------------------------------ ①② 凭证与流水：撤掉改写权
    EXECUTE 'REVOKE UPDATE, DELETE ON ledger_transactions FROM app_rw';
    EXECUTE 'REVOKE UPDATE, DELETE ON invoices, credit_notes FROM app_rw';
    -- 直接点名删变体这条路也一并堵掉（级联那条靠下面的 FK=RESTRICT）
    EXECUTE 'REVOKE DELETE ON product_variants FROM app_rw';
    RAISE NOTICE '已撤：ledger_transactions / invoices / credit_notes 的 UPDATE+DELETE，product_variants 的 DELETE';

    ------------------------------------------------------------------ ③ stock_movements.variant_id：CASCADE → RESTRICT
    SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid = 'stock_movements'::regclass
          AND confrelid = 'product_variants'::regclass
    ) INTO has_fk;

    IF NOT has_fk THEN
        RAISE WARNING 'stock_movements 上找不到指向 product_variants 的外键（分区重建未跑？跳过 FK 收紧）';
    ELSE
        FOR c IN
            SELECT con.conname
            FROM pg_constraint con
            WHERE con.contype = 'f'
              AND con.conrelid = 'stock_movements'::regclass
              AND con.confrelid = 'product_variants'::regclass
              AND con.confdeltype = 'c'
        LOOP
            EXECUTE format('ALTER TABLE stock_movements DROP CONSTRAINT %I', c.conname);
            -- 约束名沿用 0014 的 sm_variant_fk，免得同一个库里出现两种命名（叶分区随父表一起重建约束）
            EXECUTE 'ALTER TABLE stock_movements ADD CONSTRAINT sm_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT';
            RAISE NOTICE '外键 % 已由 CASCADE 重建为 RESTRICT', c.conname;
        END LOOP;

        IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE contype = 'f'
              AND conrelid = 'stock_movements'::regclass
              AND confrelid = 'product_variants'::regclass
              AND confdeltype = 'c'
        ) THEN
            RAISE EXCEPTION 'FK 收紧后仍有一条 CASCADE 存活，请人工核对';
        END IF;
    END IF;
END $$;
