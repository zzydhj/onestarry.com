import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { addresses, legalEntities, markets, orderItems, orderLines, orders, products, productVariants } from "./schema";

/**
 * 订单域冒烟：事务内建 legal_entity→market→product→variant→address→order→item→line，读回断言，最后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:orders
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Order LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `od_${suffix}`, name: "Order Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `OD-${suffix}` }).returning();
            const [addr] = await tx.insert(addresses).values({ recipient: "Jane Doe", line1: "1 Main St", country: "US" }).returning();

            const [order] = await tx
                .insert(orders)
                .values({
                    orderNumber: `SO-${suffix}`,
                    email: "buyer@example.com",
                    marketId: mk!.id,
                    currency: "USD",
                    shippingAddressId: addr!.id,
                    subtotalCents: 10000,
                    totalCents: 11685,
                })
                .returning();

            const [item] = await tx
                .insert(orderItems)
                .values({ orderId: order!.id, variantId: variant!.id, quantity: 1, unitPriceCents: 10000, snapshot: { title: "Smoke Product" } })
                .returning();
            await tx.insert(orderLines).values({ orderId: order!.id, orderItemId: item!.id, type: "item", amountCents: 10000 });
            await tx.insert(orderLines).values({ orderId: order!.id, type: "tax", amountCents: 1685, taxRate: "0.19" });

            // 读回断言
            const [got] = await tx.select().from(orders).where(eq(orders.id, order!.id));
            assert.equal(got?.status, "pending", "默认 status=pending");
            assert.equal(got?.paymentStatus, "unpaid", "默认 payment_status=unpaid");
            assert.equal(got?.fulfillmentStatus, "unfulfilled");

            const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, order!.id));
            assert.equal(lines.length, 2, "应有 2 条明细行（item + tax）");

            console.log(`✅ 订单域：建单 SO-${suffix} + 1 item + 2 line，读回状态正确（lines=${lines.length}）`);
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ ORDERS SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
