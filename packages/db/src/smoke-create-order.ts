import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import {
    inventory,
    legalEntities,
    markets,
    orderItems,
    orderLines,
    orders,
    productTranslations,
    products,
    productVariants,
    transactionalOutbox,
    variantMarketPrices,
} from "./schema";
import { createOrder, getOrderByNumber, recomputeVariantMarketPrice, type RecomputeInput } from "./queries";

/**
 * 结账服务冒烟：先算出 variant 全包价缓存 → createOrder → 断言订单/明细/发 outbox 事件 + 幂等重放拦截，最后回滚。
 *
 * 另带一段 M3 回归（标题固化）：下单时把商品名写进 order_items.snapshot，之后运营改名不得拖动历史单；
 * 并用一条“无 title 的旧形状 snapshot”验证读侧的回退分支仍然工作（向后兼容不得被新逻辑关掉）。
 *
 * 还带一段 L1 回归（币种）：订单币种由价格行派生（调用方传不了），同一单混进两种币种必须拒单。
 * 运行：pnpm --filter @onestarry/db smoke:create-order
 */
const ROLLBACK = Symbol("rollback");

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `CO LE ${suffix}` }).returning();
            const [mk] = await tx.insert(markets).values({ code: `co_${suffix}`, name: "CO Mkt", currency: "USD", legalEntityId: le!.id }).returning();
            const [prod] = await tx.insert(products).values({ status: "active" }).returning();
            const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `CO-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }).returning();

            // 可售事实：createOrder 现在按 computeSellability 校 inventory（in_stock_only 需可售库存≥数量），故补一行库存。
            await tx.insert(inventory).values({ variantId: variant!.id, onHand: 100, reserved: 0 });

            // M3：给商品一个可辨识的标题，下单后会被改名来验证“历史单不跟着变”
            const ORIGINAL = `Smoke Mug ${suffix}`;
            await tx.insert(productTranslations).values({ productId: prod!.id, locale: "en", title: ORIGINAL });

            // 先建全包价缓存（重算时 shipping=0）
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

            // 下单：2 件 + 整单运费 500
            const result = await createOrder(tx, {
                idempotencyKey: `idem-${suffix}`,
                email: "buyer@example.com",
                marketId: mk!.id,
                shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
                items: [{ variantId: variant!.id, quantity: 2 }],
                shippingCents: 500,
            });

            // 期望：goods 20000 + tax 4180 + duty 2000 + shipping 500 = 26680
            assert.equal(result.totalCents, 26680, "订单总额应为 26680");

            const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, result.orderId));
            const lineSum = lines.reduce((s, l) => s + l.amountCents, 0);
            assert.equal(lines.length, 4, "应有 item/shipping/tax/duty 4 条明细");
            assert.equal(lineSum, 26680, "明细求和应等于总额");

            const evs = await tx
                .select({ c: sql<number>`count(*)::int` })
                .from(transactionalOutbox)
                .where(and(eq(transactionalOutbox.aggregateType, "order"), eq(transactionalOutbox.aggregateId, result.orderId)));
            assert.ok((evs[0]?.c ?? 0) >= 1, "应发出 order.created 事件");

            // 幂等：相同 key 重放必须返回**原单**。旧行为是抛 IDEMPOTENT_REPLAY，
            // 于双击会把已经建好的单显示成“下单失败”，用户再提交一次 → 那才是重复下单。
            const replay = await createOrder(tx, {
                idempotencyKey: `idem-${suffix}`,
                email: "buyer@example.com",
                marketId: mk!.id,
                shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
                items: [{ variantId: variant!.id, quantity: 2 }],
                shippingCents: 500,
            });
            assert.equal(replay.replayed, true, "重放应标记 replayed");
            assert.equal(replay.orderId, result.orderId, "重放必须返回同一张单");
            assert.equal(replay.publicToken, result.publicToken, "重放不能发新凭证，否则旧链接失效");
            const dup = await tx.select({ c: sql<number>`count(*)::int` }).from(orders).where(eq(orders.orderNumber, result.orderNumber));
            assert.equal(dup[0]?.c, 1, "重放不许建出第二张单");

            // 单号熵与访问凭证（这两条是 2026-10-23 审查 P0-1/P0-2 的正身）
            assert.match(result.orderNumber, /^SO-[0-9A-Z]+-[0-9A-Z]{8}$/, "新单号随机段应为 8 位");
            assert.match(result.publicToken, /^[0-9A-Za-z_-]{22}$/, "新单必须带 22 位 base64url 访问凭证");

            /* ---------------- M3：标题必须冻在 snapshot 里，改名不得拖动历史单 ---------------- */
            const [frozen] = await tx
                .select({ id: orderItems.id, snapshot: orderItems.snapshot })
                .from(orderItems)
                .where(eq(orderItems.orderId, result.orderId))
                .limit(1);
            assert.equal(
                (frozen!.snapshot as { title?: string | null }).title,
                ORIGINAL,
                `createOrder 必须把标题写进 snapshot，实际 ${(JSON.stringify(frozen!.snapshot) ?? "无")}`,
            );

            // 再插一条“旧形状”的行（snapshot 里没有 title），专门验读侧回退到当前译文那一条路还活着
            const [legacy] = await tx
                .insert(orderItems)
                .values({ orderId: result.orderId, variantId: variant!.id, quantity: 1, unitPriceCents: 100, snapshot: { currency: "USD", listPriceCents: 100, allInCents: 120 } })
                .returning({ id: orderItems.id });

            const RENAMED = `RENAMED Mug ${suffix}`;
            await tx.update(productTranslations).set({ title: RENAMED }).where(eq(productTranslations.productId, prod!.id));

            const view = await getOrderByNumber(tx, result.orderNumber);
            const titleOf = (id: string) => (view?.items.find((i) => i.id === id) as unknown as { title?: string | null } | undefined)?.title ?? null;
            assert.equal(titleOf(frozen!.id), ORIGINAL, "审查 M3：新单的标题必须来自下单时的 snapshot，不得跟随改名后的译文");
            assert.equal(titleOf(legacy!.id), RENAMED, "旧单（snapshot 无 title）必须回退到当前译文，否则历史订单反而全变成空");

            // 顺便把注释里那句“JSON null ->> 出来是什么”量清，不凭记性写断言
            const [jsonNull] = (await tx.execute(
                sql`select ('{\"title\":null}'::jsonb ->> 'title') is null as is_sql_null, coalesce(nullif('{\"title\":null}'::jsonb->>'title',''),'FALLBACK') as coalesced`,
            )) as unknown as { is_sql_null: boolean; coalesced: string }[];
            console.log(`ℹ JSON null 经 ->> 的结果：is_sql_null=${jsonNull!.is_sql_null} coalesced=${jsonNull!.coalesced}`);

            console.log(
                `✅ M3：标题已固化（改名后历史单仍为“${ORIGINAL}”，无 title 的旧行回退为当前译文）`,
            );

            /* ---------------- L1：订单币种从价格行派生；混币种必须拒单 ---------------- */
            // 1) 派生：另开一个 EUR 市场并算好 EUR 价 → 下单不传任何币种，orders.currency 必须跟着变 EUR。
            //    旧写法由调用方写死 "USD"：市场改成 EUR 后金额按 EUR 算、币种写 USD，全站没人会发现。
            const [mkEur] = await tx
                .insert(markets)
                .values({ code: `co_eur_${suffix}`, name: "CO EUR", currency: "EUR", legalEntityId: le!.id })
                .returning();
            const [prodEur] = await tx.insert(products).values({ status: "active" }).returning();
            const [variantEur] = await tx
                .insert(productVariants)
                .values({ productId: prodEur!.id, sku: `CO-EUR-${suffix}`, basePriceCents: 10000, baseCurrency: "EUR" })
                .returning();
            await tx.insert(inventory).values({ variantId: variantEur!.id, onHand: 10, reserved: 0 });
            await recomputeVariantMarketPrice(tx, { ...priceInput, marketId: mkEur!.id, baseCurrency: "EUR", marketCurrency: "EUR", variantId: variantEur!.id });

            const eurOrder = await createOrder(tx, {
                idempotencyKey: `idem-eur-${suffix}`,
                email: "buyer@example.com",
                marketId: mkEur!.id,
                shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "DE" },
                items: [{ variantId: variantEur!.id, quantity: 1 }],
                shippingCents: 0,
            });
            const [eurRow] = await tx.select({ currency: orders.currency }).from(orders).where(eq(orders.id, eurOrder.orderId)).limit(1);
            assert.equal(eurRow?.currency, "EUR", `币种必须由价格行派生成 EUR，实际 ${String(eurRow?.currency)}`);
            console.log("✅ L1：订单币种跟价格行走（EUR 市场下单 → orders.currency=EUR，调用方无权指定）");

            // 2) 负向：同一张单里混进两种币种的价格行（脏数据/市场配错）→ 必须拒单。
            //    手工插一行“EUR 市场里的 USD 价格行”来造这个脏数据（重算路径不会产生，但库层无约束）。
            await tx.insert(variantMarketPrices).values({
                variantId: variant!.id,
                marketId: mkEur!.id,
                currency: "USD",
                goodsCents: 10000,
                listPriceCents: 12000,
                allInCents: 12000,
                pricingMode: "fixed_gross",
                dutyPresentation: "included_in_price",
                inputsHash: `smoke-mixed-${suffix}`,
            });
            let mixedMsg = "";
            try {
                await tx.transaction(async (sp) => {
                    await createOrder(sp, {
                        idempotencyKey: `idem-mixed-${suffix}`,
                        email: "buyer@example.com",
                        marketId: mkEur!.id,
                        shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "DE" },
                        items: [
                            { variantId: variantEur!.id, quantity: 1 },
                            { variantId: variant!.id, quantity: 1 },
                        ],
                        shippingCents: 0,
                    });
                });
            } catch (e) {
                mixedMsg = e instanceof Error ? e.message : String(e);
            }
            assert.match(mixedMsg, /CURRENCY_MIXED/, `混币种必须拒单（实际：${mixedMsg || "没报错——币种闸失效"}）`);
            const eurOrders = await tx.select({ id: orders.id }).from(orders).where(eq(orders.marketId, mkEur!.id));
            assert.equal(eurOrders.length, 1, "被拒的那次不得留下任何订单（只留下上面那 1 张 EUR 单）");
            console.log("✅ L1：同单混币种被 CURRENCY_MIXED 拒掉、零悬挂单");

            console.log(
                `✅ 结账：建单 ${result.orderNumber} 总=${result.totalCents}，4 明细求和一致，已发 order.created，` +
                `幂等重放返回原单，凭证 ${result.publicToken.length} 位`,
            );
            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ CREATE-ORDER SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
