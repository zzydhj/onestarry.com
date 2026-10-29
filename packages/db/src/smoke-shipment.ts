import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import {
    inventory,
    ledgerEntries,
    ledgerTransactions,
    legalEntities,
    markets,
    orders,
    products,
    productVariants,
    shipments,
    stockMovements,
    transactionalOutbox,
} from "./schema";
import {
    createOrder,
    recordPaymentSucceeded,
    recordShipment,
    recomputeVariantMarketPrice,
    seedLedgerAccounts,
    type RecomputeInput,
} from "./queries";

/**
 * 履约发货段端到端冒烟：seed→建价缓存→createOrder→支付落账→发货落账，断言后回滚。
 * 运行：pnpm --filter @onestarry/db smoke:shipment
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `Shp LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `sh_${suffix}`, name: "Shp Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx
                .insert(productVariants)
                .values({ productId: prod!.id, sku: `SH-${suffix}`, basePriceCents: 10000, baseCurrency: "USD", costCents: 4000 })
                .returning();
            await tx.insert(inventory).values({ variantId: variant!.id, onHand: 100, reserved: 0 });
            await seedLedgerAccounts(tx, le!.id);

            const priceInput: RecomputeInput = {
                variantId: variant!.id,
                marketId: mk!.id,
                basePriceCents: 10000,
                baseCurrency: "USD",
                fxRate: 1,
                marketCurrency: "USD",
                shippingCents: 0,
                taxRate: 0.19,
                dutyRate: 0.1,
                pricingMode: "fixed_gross",
                dutyPresentation: "included_in_price",
                thresholdCents: 15000,
                overThresholdPolicy: "block",
            };
            await recomputeVariantMarketPrice(tx, priceInput);

            const order = await createOrder(tx, {
                idempotencyKey: `shidem-${suffix}`,
                email: "b@example.com",
                marketId: mk!.id,
                shippingAddress: { recipient: "Jane", line1: "1 St", country: "US" },
                items: [{ variantId: variant!.id, quantity: 2 }],
                shippingCents: 500,
            });
            await recordPaymentSucceeded(tx, { orderId: order.orderId, provider: "fake", providerRef: `pi_${suffix}`, jurisdiction: "US" });

            const ship = await recordShipment(tx, { orderId: order.orderId, carrier: "fake", trackingNumber: `FAKE-${suffix}` });
            assert.equal(ship.cogsCents, 8000, "COGS = 4000×2");

            // 订单转 fulfilled
            const gotOrder = (await tx.select().from(orders).where(eq(orders.id, order.orderId)))[0];
            assert.equal(gotOrder?.fulfillmentStatus, "fulfilled");

            // 库存扣减 100 → 98
            const inv = (await tx.select().from(inventory).where(eq(inventory.variantId, variant!.id)))[0];
            assert.equal(inv?.onHand, 98, "on_hand 应 100→98");

            // 发货段借贷平衡：借 customer_deposits(20500)+cogs(8000)=28500 / 贷 revenue(20000)+shipping_revenue(500)+inventory_asset(8000)=28500
            const txn = (await tx.select().from(ledgerTransactions).where(eq(ledgerTransactions.referenceId, ship.shipmentId)))[0];
            assert.ok(txn, "发货段 ledger txn 应存在");
            const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, txn!.id));
            const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountFunctional, 0);
            const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amountFunctional, 0);
            assert.equal(debit, credit, "发货段借贷必须相等");
            assert.equal(debit, 28500, "发货段借方合计应 28500");

            // sale 流水
            const sales = await tx.select().from(stockMovements).where(and(eq(stockMovements.variantId, variant!.id), eq(stockMovements.type, "sale")));
            assert.equal(sales[0]?.quantity, -2, "应写 sale 流水 quantity=-2");

            // 事件：order.created + order.shipped
            const evs = await tx.select().from(transactionalOutbox).where(and(eq(transactionalOutbox.aggregateType, "order"), eq(transactionalOutbox.aggregateId, order.orderId)));
            assert.ok(evs.length >= 2, "应发 order.created + order.shipped 两事件");

            console.log(`✅ 履约发货段：COGS=${ship.cogsCents}、on_hand 100→${inv?.onHand}、借贷平衡(${debit}=${credit})、订单 fulfilled、事件 ${evs.length} 条`);

            // —— M-3：缺参考成本的变体不得静默记 0 COGS ——
            const [variant2] = await tx
                .insert(productVariants)
                .values({ productId: prod!.id, sku: `SHNC-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }) // 不设 costCents
                .returning();
            await tx.insert(inventory).values({ variantId: variant2!.id, onHand: 10, reserved: 0 });
            await recomputeVariantMarketPrice(tx, { ...priceInput, variantId: variant2!.id });
            const order2 = await createOrder(tx, {
                idempotencyKey: `shnc-${suffix}`,
                email: "b2@example.com",
                marketId: mk!.id,
                shippingAddress: { recipient: "John", line1: "2 St", country: "US" },
                items: [{ variantId: variant2!.id, quantity: 1 }],
                shippingCents: 0,
            });
            await recordPaymentSucceeded(tx, { orderId: order2.orderId, provider: "fake", providerRef: `pi_2_${suffix}`, jurisdiction: "US" });
            let cogsMsg = "";
            try {
                await recordShipment(tx, { orderId: order2.orderId, carrier: "fake", trackingNumber: `NC-${suffix}` });
            } catch (e) {
                cogsMsg = e instanceof Error ? e.message : String(e);
            }
            assert.match(cogsMsg, /COGS_COST_UNKNOWN/, `缺成本价应抛 COGS_COST_UNKNOWN（实际：${cogsMsg || "没报错——M-3 未修好"}）`);
            console.log("✅ M-3：缺参考成本的变体发货被 COGS_COST_UNKNOWN 拦下（不静默记 0）");

            // —— C-1 并发发货防护的负向验证 ——
            // 1) 应用层守卫：对已 fulfilled 的单再发一次 → 必须 ALREADY_FULFILLED（不重复确认收入/重复扣库存）。
            let guardMsg = "";
            try {
                await recordShipment(tx, { orderId: order.orderId, carrier: "fake", trackingNumber: `DUP-${suffix}` });
            } catch (e) {
                guardMsg = e instanceof Error ? e.message : String(e);
            }
            assert.match(guardMsg, /ALREADY_FULFILLED/, `二次发货应被应用层守卫拒（实际：${guardMsg || "没报错——守卫失效"}）`);

            // 2) 数据库层兜底：退回旧单 allowed（status='returned' 排除在唯一索引外），再插第二张未退回单必须被 ship_order_uq 拒。
            await tx.insert(shipments).values({ orderId: order.orderId, status: "returned", trackingNumber: `RTN-${suffix}` });
            let idxViolated = false;
            let idxInfo = "";
            try {
                await tx.insert(shipments).values({ orderId: order.orderId, status: "shipped", trackingNumber: `SHX-${suffix}` });
            } catch (e) {
                idxViolated = true;
                const anyErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
                idxInfo = `code=${anyErr.code ?? anyErr.cause?.code ?? ""} constraint=${anyErr.constraint ?? anyErr.cause?.constraint ?? ""}`;
            }
            // ↑ 23505 会 abort 事务，之后不能再跑 SQL，故这是本事务最后一步断言。
            assert.ok(idxViolated, `同单第二张未退回运单必须被唯一索引拒掉（否则 C-1 DB 兜底未生效）：${idxInfo}`);
            assert.ok(idxInfo.includes("23505") || /ship_order_uq/i.test(idxInfo), `应因 ship_order_uq 拒掉，实际：${idxInfo}`);
            console.log("✅ C-1：二次发货被 ALREADY_FULFILLED 挡；returned 旧单放行、第二张未退回单被 ship_order_uq 拒");

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ SHIPMENT SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
