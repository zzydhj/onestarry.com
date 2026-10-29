import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { createDb } from "./client";
import {
    inventory,
    legalEntities,
    markets,
    productMarketAvailability,
    productTranslations,
    products,
    productVariants,
} from "./schema";
import { createOrder, getCartLines, getProductById, recomputeVariantMarketPrice, type RecomputeInput } from "./queries";

/**
 * 可售性拒绝路径冒烟（审查 H2 的真验证）：证明 createOrder 接 computeSellability 后，
 * 「归档商品 / 黑名单市场 / 库存不足」真的建不出单，而「正常在售有货」仍能建单（防过度拦截）。
 * 全程一个事务，最后回滚，不留数据。运行：pnpm --filter @onestarry/db smoke:sellability
 */
const ROLLBACK = Symbol("rollback");

/** 跑一次下单，断言其抛 NOT_SELLABLE 且原因串含预期 token；返回捕获的错误信息。 */
async function expectReject(
    tx: Parameters<typeof createOrder>[0],
    label: string,
    token: string,
    args: Parameters<typeof createOrder>[1],
): Promise<string> {
    let msg = "";
    try {
        await createOrder(tx, args);
    } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
    }
    if (!msg) throw new Error(`${label}：本应被挡，却建单成功了`);
    assert.match(msg, /^NOT_SELLABLE:/, `${label}：错误码应是 NOT_SELLABLE，实际：${msg}`);
    assert.ok(msg.includes(token), `${label}：原因应含 "${token}"，实际：${msg}`);
    return msg;
}

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);
    const suffix = Date.now();

    const orderFor = (variantId: string, key: string, qty = 2): Parameters<typeof createOrder>[1] => ({
        idempotencyKey: key,
        email: "buyer@example.com",
        marketId: "", // 下方按 mk 覆盖
        shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
        items: [{ variantId, quantity: qty }],
        shippingCents: 500,
    });

    try {
        await db.transaction(async (tx) => {
            const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `SB LE ${suffix}` }).returning();
            const [mk] = await tx
                .insert(markets)
                .values({ code: `sb_${suffix}`, name: "SB Mkt", currency: "USD", legalEntityId: le!.id })
                .returning();

            // 造一个「可售事实」商品：status + 库存 onHand/reserved + 可选市场黑名单，并算好全包价。
            const makeVariant = async (o: {
                status: "draft" | "active" | "archived";
                onHand: number;
                reserved?: number;
                deny?: boolean;
                tag: string;
            }) => {
                const [prod] = await tx.insert(products).values({ status: o.status }).returning();
                const [variant] = await tx
                    .insert(productVariants)
                    .values({ productId: prod!.id, sku: `SB-${o.tag}-${suffix}`, basePriceCents: 10000, baseCurrency: "USD", isPrimary: true })
                    .returning();
                // getProductById 需要一条当前 locale 的译文才能 innerJoin 命中（PDP 取数依赖）。
                await tx
                    .insert(productTranslations)
                    .values({ productId: prod!.id, locale: "en", title: `SB ${o.tag}` });
                await tx.insert(inventory).values({ variantId: variant!.id, onHand: o.onHand, reserved: o.reserved ?? 0 });
                if (o.deny) {
                    await tx.insert(productMarketAvailability).values({ productId: prod!.id, marketId: mk!.id, mode: "deny" });
                }
                const priceInput: RecomputeInput = {
                    variantId: variant!.id,
                    marketId: mk!.id,
                    basePriceCents: 10000,
                    baseCurrency: "USD",
                    fxRate: 1,
                    marketCurrency: "USD",
                    shippingCents: 0,
                    taxRate: 0,
                    dutyRate: 0,
                    pricingMode: "fixed_gross",
                    dutyPresentation: "separate_line",
                    thresholdCents: null,
                    overThresholdPolicy: "block",
                };
                await recomputeVariantMarketPrice(tx, priceInput);
                return { productId: prod!.id, variantId: variant!.id };
            };

            // 对照：正常在售 + 有货（100 可用）→ 必须能建单（证明我没把正常路径也挡了）
            const ok = await makeVariant({ status: "active", onHand: 100, tag: "ok" });
            const okRes = await createOrder(tx, { ...orderFor(ok.variantId, `sb-ok-${suffix}`, 2), marketId: mk!.id });
            assert.ok(okRes.orderId, "对照：正常在售有货必须能下单");

            // A) 归档商品（即便有价格行、有库存）→ product_not_active
            const archived = await makeVariant({ status: "archived", onHand: 100, tag: "arch" });
            console.log("  ↪", await expectReject(tx, "A 归档商品", "product_not_active", { ...orderFor(archived.variantId, `sb-arch-${suffix}`), marketId: mk!.id }));

            // B) 库存不足：in_stock_only 默认策略，可用 1、下单 2 → insufficient_stock（验我加的「可售库存≥数量」这条）
            const lowStock = await makeVariant({ status: "active", onHand: 1, tag: "low" });
            console.log("  ↪", await expectReject(tx, "B 库存不足", "insufficient_stock", { ...orderFor(lowStock.variantId, `sb-low-${suffix}`, 2), marketId: mk!.id }));

            // B') 完全缺货：可用 0 → out_of_stock（computeSellability 的 <=0 判定）
            const noStock = await makeVariant({ status: "active", onHand: 0, tag: "none" });
            console.log("  ↪", await expectReject(tx, "B' 缺货", "out_of_stock", { ...orderFor(noStock.variantId, `sb-none-${suffix}`), marketId: mk!.id }));

            // C) 市场黑名单命中（product 级 deny）→ availability_denied（验那条相关子查询 EXISTS 真能生效）
            const denied = await makeVariant({ status: "active", onHand: 100, deny: true, tag: "deny" });
            console.log("  ↪", await expectReject(tx, "C 市场禁售", "availability_denied", { ...orderFor(denied.variantId, `sb-deny-${suffix}`), marketId: mk!.id }));

            console.log("✅ 可售性：正常单放行，归档/缺货/不足/禁售四类各自被挡且原因正确");

            // H-3：PDP 取数 getProductById 必须只给在售商品——归档商品经直链也不能取到（防公网渲染/加购）。
            // 用上面造的 active(ok) 与 archived 两个商品，同一市场码。
            const detailOk = await getProductById(tx, ok.productId, `sb_${suffix}`, "en");
            assert.ok(detailOk, "在售商品 PDP 应能取到");
            const detailArch = await getProductById(tx, archived.productId, `sb_${suffix}`, "en");
            assert.equal(detailArch, null, `归档商品 PDP 必须取不到（H-3），实际：${JSON.stringify(detailArch)}`);
            console.log("✅ H-3：getProductById 对在售命中、对归档商品返回 null");

            // M-7：getCartLines 必须带出 productStatus（不丢行），供上层标“不再可售”。
            const cartLines = await getCartLines(tx, [ok.variantId, archived.variantId], `sb_${suffix}`, "en");
            const byVariant = new Map(cartLines.map((c) => [c.variantId, c]));
            assert.equal(byVariant.get(ok.variantId)?.productStatus, "active", "在售行应带 productStatus=active");
            assert.equal(byVariant.get(archived.variantId)?.productStatus, "archived", "归档行应带出且 productStatus=archived（M-7）");
            console.log("✅ M-7：getCartLines 带出 productStatus，归档行不被静默丢弃");

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    }
    console.log("✅ SELLABILITY SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
