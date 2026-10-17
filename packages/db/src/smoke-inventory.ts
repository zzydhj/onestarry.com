import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { createDb } from "./client";
import { inventory, products, productVariants, stockMovements } from "./schema";
import { getStock } from "./queries";

/**
 * 库存冒烟：事务内建 product→variant→inventory→movement，断言生成列 available = on_hand - reserved，最后回滚。
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
