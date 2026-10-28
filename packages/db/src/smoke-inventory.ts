import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import { inventory, products, productVariants, stockMovements } from "./schema";
import { getStock, receiveStock, setVariantOnHand } from "./queries";

/**
 * 库存冒烟：事务内建 product→variant→inventory→movement，断言生成列 available = on_hand - reserved；
 * 再走**真实入库写路径 `receiveStock`**（审查 M1：`on_hand = on_hand + net` 原子增量 + RETURNING 取真值），
 * 验两种分支：① 已有行 → 增量累加；② 无行 → 按净增量新建。最后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:inventory
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置（先跑 neon env pull）");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            if (!prod) throw new Error("product insert 未返回行");
            const [variant] = await tx
                .insert(productVariants)
                .values({ productId: prod.id, sku: `SMOKE-SKU-${suffix}` })
                .returning();
            if (!variant) throw new Error("variant insert 未返回行");

            await tx.insert(inventory).values({ variantId: variant.id, onHand: 10, reserved: 3 });
            await tx
                .insert(stockMovements)
                .values({ variantId: variant.id, type: "receive", quantity: 10, onHandAfter: 10, unitCostCents: 500 });

            const stock = await getStock(tx, variant.id);
            assert.equal(stock.onHand, 10);
            assert.equal(stock.reserved, 3);
            assert.equal(stock.available, 7, "生成列 available 应 = on_hand - reserved = 7");

            // ✅ 走真实入库写路径 receiveStock（不是手工插行）——已有行 → 增量累加、RETURNING 取并发后真值
            const r1 = await receiveStock(tx, { variantId: variant.id, qtyReceived: 5, unitCostCents: 100, currency: "USD" });
            assert.equal(r1.onHandAfter, 15, `入库 +5 后 on_hand 应 10→15，实际 ${r1.onHandAfter}`);
            const r2 = await receiveStock(tx, { variantId: variant.id, qtyReceived: 4, qtyDamaged: 1, unitCostCents: 100, currency: "USD" });
            assert.equal(r2.onHandAfter, 18, `再入库 +4 破 -1 后应 15→18，实际 ${r2.onHandAfter}`);
            const stock2 = await getStock(tx, variant.id);
            assert.equal(stock2.onHand, 18, "receiveStock 后 DB on_hand 应为 18");
            assert.equal(stock2.available, 15, "available 随生成列跟随 = 18 - 3");

            // ✅ 无库存行的变体：receiveStock 走 insert 分支，on_hand 初值 = 净增量（7 - 2 = 5）
            const [v2] = await tx.insert(productVariants).values({ productId: prod.id, sku: `SMOKE-SKU2-${suffix}` }).returning();
            if (!v2) throw new Error("variant2 insert 未返回行");
            const r3 = await receiveStock(tx, { variantId: v2.id, qtyReceived: 7, qtyDamaged: 2, unitCostCents: 100, currency: "USD" });
            assert.equal(r3.onHandAfter, 5, `新建行净增量应为 7-2=5，实际 ${r3.onHandAfter}`);

            console.log(`✅ receiveStock 原子路径：累加 10→15→18（RETURNING 取真值）、新建 7-2=5`);

            // ✅ M-4：setVariantOnHand 绝对值 set（内部事务 + FOR UPDATE）：从 18 设到 100 → delta=82 且写一条 adjustment 流水；
            //   再设回 100 → delta=0、**不重复写流水**（并发旧写法会各自从旧值算 delta 而虚增，这里验证同口径只记一次）。
            const s1 = await setVariantOnHand(tx, { variantId: variant.id, onHand: 100, changedBy: "smoke" });
            assert.equal(s1.delta, 82, `18→100 的 delta 应为 82，实际 ${s1.delta}`);
            const stock3 = await getStock(tx, variant.id);
            assert.equal(stock3.onHand, 100, "setVariantOnHand 后 DB on_hand 应为 100");
            const s2 = await setVariantOnHand(tx, { variantId: variant.id, onHand: 100 });
            assert.equal(s2.delta, 0, `同值再设 delta 应为 0，实际 ${s2.delta}`);
            const adj = await tx
                .select({ id: stockMovements.id })
                .from(stockMovements)
                .where(and(eq(stockMovements.variantId, variant.id), eq(stockMovements.type, "adjustment")));
            assert.equal(adj.length, 1, `只应有一条 adjustment 流水（+82），实际 ${adj.length} 条`);
            console.log("✅ M-4：setVariantOnHand 绝对值 set、同值不重复记流水（FOR UPDATE 事务内）");

            console.log(`✅ 库存生成列正确：on_hand=${stock.onHand} reserved=${stock.reserved} available=${stock.available}`);
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ INVENTORY SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
