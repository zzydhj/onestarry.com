import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { createDb } from "./client";
import { inventory, legalEntities, markets, payments, productVariants, products, refunds } from "./schema";
import { createOrder, recomputeVariantMarketPrice, type RecomputeInput } from "./queries";

/**
 * 退款并发去重冒烟（审查 M5 的真验证）：证明 refunds 上的部分唯一索引
 * (payment_id, provider_ref) 能在数据库层挡住「同笔退款的重复台账行」。
 * 代码里的「先 SELECT 后 INSERT」去重挡不住两个都越过 SELECT 的并发，这条索引才是兜底。
 * 全程一个事务，最后回滚，不留数据。运行：pnpm --filter @onestarry/db smoke:refund-dedup
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `RD LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `rd_${suffix}`, name: "RD Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `RD-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }).returning();
            await tx.insert(inventory).values({ variantId: variant!.id, onHand: 100, reserved: 0 });

            const priceInput: RecomputeInput = {
                variantId: variant!.id, marketId: mk!.id, basePriceCents: 10000, baseCurrency: "USD",
                fxRate: 1, marketCurrency: "USD", shippingCents: 0, taxRate: 0, dutyRate: 0,
                pricingMode: "fixed_gross", dutyPresentation: "separate_line", thresholdCents: null, overThresholdPolicy: "block",
            };
            await recomputeVariantMarketPrice(tx, priceInput);
            const order = await createOrder(tx, {
                idempotencyKey: `rd-${suffix}`, email: "buyer@example.com", marketId: mk!.id, currency: "USD",
                shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
                items: [{ variantId: variant!.id, quantity: 2 }], shippingCents: 500,
            });

            const [pay] = await tx.insert(payments).values({
                orderId: order.orderId, provider: "paypal", providerRef: `CAP-${suffix}`,
                amountCents: order.totalCents, currency: "USD", status: "succeeded",
            }).returning();

            const refundRow = {
                paymentId: pay!.id, orderId: order.orderId, provider: "paypal",
                providerRef: `REF-${suffix}`, amountCents: order.totalCents, currency: "USD", status: "succeeded",
            };

            // 第一笔退款台账：应成功
            await tx.insert(refunds).values(refundRow);

            // 对照：同一 payment 但不同 provider_ref 的第二笔退款（合法的部分退款）→ 必须能插入，
            // 否则分不出下面的失败是"重复键"还是"整表坏了"。
            await tx.insert(refunds).values({ ...refundRow, providerRef: `REF-${suffix}-B` });

            // 同 (payment_id, provider_ref) 的再一笔（模拟并发里越过 SELECT 的重复插入）：必须被唯一索引挡下
            let violated = false;
            let info = "";
            try {
                await tx.insert(refunds).values(refundRow);
            } catch (e) {
                violated = true;
                const anyErr = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string }; message?: string };
                info = `code=${anyErr.code ?? anyErr.cause?.code ?? ""} constraint=${anyErr.constraint ?? anyErr.cause?.constraint ?? ""}`;
            }
            console.log(`  ↪ 重复插入拦截：${violated}；${info}`);
            assert.ok(violated, "重复退款台账必须被数据库拒绝（否则 M5 没真正修好）");
            assert.ok(
                info.includes("23505") || /refund_payment_ref_uq/i.test(info),
                `应因唯一索引 refund_payment_ref_uq 拒掉（23505），实际：${info}`,
            );

            console.log("✅ M5：同笔退款 (payment_id, provider_ref) 的第二条台账被部分唯一索引当场拒掉");
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ REFUND DEDUP SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
