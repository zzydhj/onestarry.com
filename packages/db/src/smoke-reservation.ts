import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb, type Tx } from "./client";
import { inventory, legalEntities, markets, orders, products, productVariants } from "./schema";
import {
    createOrder,
    recordPaymentReversal,
    recordPaymentSucceeded,
    recordShipment,
    recomputeVariantMarketPrice,
    releaseExpiredReservations,
    seedLedgerAccounts,
    type RecomputeInput,
} from "./queries";

/**
 * 在途库存预留（审查 H-2）端到端冒烟：下单原子占位 → 并发超卖被挡 → 发货消耗 → 未付过期回收 → 整笔退款释放。
 * 全程在一个事务里跑完再回滚，不留测试数据；预期失败的用例走嵌套 savepoint（drizzle 内层 transaction 即 SAVEPOINT）。
 * 运行：pnpm --filter @onestarry/db smoke:reservation
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Rsrv LE ${suffix}` }).returning();
            const [mk] = await tx
                .insert(markets)
                .values({ code: `rs_${suffix}`, name: "Rsrv Mkt", currency: "USD", legalEntityId: le!.id })
                .returning();
            await seedLedgerAccounts(tx, le!.id);
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();

            const priceBase: Omit<RecomputeInput, "variantId"> = {
                marketId: mk!.id,
                basePriceCents: 10000,
                baseCurrency: "USD",
                fxRate: 1,
                marketCurrency: "USD",
                shippingCents: 0,
                taxRate: 0,
                dutyRate: 0,
                pricingMode: "fixed_gross",
                dutyPresentation: "included_in_price",
                thresholdCents: 15000,
                overThresholdPolicy: "block",
            };

            const mkVariant = async (sku: string, policy: "in_stock_only" | "backorder", onHand: number) => {
                const [v] = await tx
                    .insert(productVariants)
                    .values({
                        productId: prod!.id,
                        sku: `${sku}-${suffix}`,
                        basePriceCents: 10000,
                        baseCurrency: "USD",
                        costCents: 4000,
                        availabilityPolicy: policy,
                    })
                    .returning();
                await tx.insert(inventory).values({ variantId: v!.id, onHand, reserved: 0 });
                await recomputeVariantMarketPrice(tx, { ...priceBase, variantId: v!.id });
                return v!;
            };
            const stock = async (vid: string) => (await tx.select().from(inventory).where(eq(inventory.variantId, vid)).limit(1))[0];
            const orderRow = async (id: string) => (await tx.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
            const orderFor = (variantId: string, key: string, qty: number) => ({
                idempotencyKey: key,
                email: "r@example.com",
                marketId: mk!.id,
                currency: "USD",
                shippingAddress: { recipient: "R", line1: "1 St", country: "US" },
                items: [{ variantId, quantity: qty }],
                shippingCents: 0,
            });

            // ── 1) 下单原子占位：最后一件被占后，第二单必须抢输、且不留悬挂 reserved ──
            const vA = await mkVariant("RSA", "in_stock_only", 1);
            const oA = await createOrder(tx, orderFor(vA.id, `rs-a1-${suffix}`, 1));
            assert.equal((await stock(vA.id))?.reserved, 1, "占位后 reserved 应=1");
            assert.equal((await stock(vA.id))?.available, 0, "available 应=0（on_hand 1 - reserved 1）");
            assert.deepEqual((await orderRow(oA.orderId))?.reservation as Record<string, number>, { [vA.id]: 1 }, "orders.reservation 应记快照");

            // 第二单抢同一件：A1 已把 available 占至 0，A2 的 JS 预检即读到 0 抛 NOT_SELLABLE:...:insufficient_stock。
            // （单连接无法制造真并发，故这里证的是“占位确实把 available 压低并挡住后续单”；
            //   同一语句里的原子 reserve 守卫是并发抢输时的兜底，二者 WHERE 同源。）
            await assert.rejects(
                () => tx.transaction(async (sp) => void (await createOrder(sp, orderFor(vA.id, `rs-a2-${suffix}`, 1)))),
                /insufficient_stock/,
                "最后一件被占后第二单必须被挡（并发超卖防护）",
            );
            assert.equal((await stock(vA.id))?.reserved, 1, "抢输的第二单不得留下任何占位（reserved 仍=1）");
            console.log("✅ H-2 占位：最后一件被占后第二单被 NOT_SELLABLE 挡下、不留悬挂 reserved");

            // ── 2) 发货消耗：reserved 回退、on_hand 递减、snapshot 清空 ──
            await recordPaymentSucceeded(tx, { orderId: oA.orderId, provider: "fake", providerRef: `rs_pi_${suffix}`, jurisdiction: "US" });
            await recordShipment(tx, { orderId: oA.orderId, carrier: "fake", trackingNumber: `rs-ship-${suffix}` });
            assert.equal((await stock(vA.id))?.reserved, 0, "发货后 reserved 应回退到 0");
            assert.equal((await stock(vA.id))?.onHand, 0, "发货后 on_hand 1→0");
            assert.equal((await orderRow(oA.orderId))?.reservation, null, "发货后 snapshot 清空");
            console.log("✅ H-2 消耗：发货后 reserved 回退、on_hand 递减、snapshot 清空");

            // ── 3) backorder 不误伤：0 库存仍可下单、不占 reserved ──
            const vB = await mkVariant("RSB", "backorder", 0);
            const oB = await createOrder(tx, orderFor(vB.id, `rs-b1-${suffix}`, 1));
            assert.equal((await stock(vB.id))?.reserved, 0, "backorder 不占 reserved");
            assert.equal((await orderRow(oB.orderId))?.reservation, null, "backorder 单 snapshot 应为 null");
            console.log("✅ H-2 不误伤：backorder 变体 0 库存仍可下单、不占 reserved");

            // ── 4) 未付过期回收：reserved 归零 + 单转 cancelled，且幂等（二次不重复回退）──
            const vC = await mkVariant("RSC", "in_stock_only", 5);
            const oC = await createOrder(tx, orderFor(vC.id, `rs-c1-${suffix}`, 2));
            assert.equal((await stock(vC.id))?.reserved, 2, "C 占 2 件");
            // now() 在事务内恒定，靠负 TTL 不行 → 直接把 created_at 拨到过去，令其超过 TTL
            await tx.update(orders).set({ createdAt: new Date(Date.now() - 99999999) }).where(eq(orders.id, oC.orderId));
            const released = await releaseExpiredReservations(tx, { ttlMinutes: 60, limit: 50 });
            assert.ok(released >= 1, "过期回收应至少释放这张");
            assert.equal((await stock(vC.id))?.reserved, 0, "过期后 reserved 回退到 0");
            const gotC = await orderRow(oC.orderId);
            assert.equal(gotC?.reservation, null, "过期后 snapshot 清空");
            assert.equal(gotC?.status, "cancelled", "过期未付单应被取消");
            // 幂等：再跑一次，reserved 不得被重复回退成负
            await releaseExpiredReservations(tx, { ttlMinutes: 60, limit: 50 });
            assert.equal((await stock(vC.id))?.reserved, 0, "二次回收不得把 reserved 减成负（幂等）");
            console.log(`✅ H-2 过期回收：释放 ${released} 张、reserved 归零、单转 cancelled、二次回收幂等`);

            // ── 5) 整笔退款（撤销）释放预留 ──
            const vD = await mkVariant("RSD", "in_stock_only", 5);
            const oD = await createOrder(tx, orderFor(vD.id, `rs-d1-${suffix}`, 1));
            assert.equal((await stock(vD.id))?.reserved, 1, "D 占 1");
            await recordPaymentSucceeded(tx, { orderId: oD.orderId, provider: "paypal", providerRef: `rs_cap_${suffix}`, jurisdiction: "US" });
            await recordPaymentReversal(tx, { provider: "paypal", orderId: oD.orderId, captureRef: `rs_cap_${suffix}`, kind: "revoked" });
            assert.equal((await stock(vD.id))?.reserved, 0, "整笔冲销后 reserved 释放");
            assert.equal((await orderRow(oD.orderId))?.reservation, null, "冲销后 snapshot 清空");
            console.log("✅ H-2 退款释放：整笔冲销后 reserved 归零、snapshot 清空");

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ RESERVATION SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
