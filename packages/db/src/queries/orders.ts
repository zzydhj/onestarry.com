import { and, eq } from "drizzle-orm";
import { addresses, idempotencyKeys, orderItems, orderLines, orders, variantMarketPrices } from "../schema";
import { emitEvent } from "./outbox";
import type { Db, Tx } from "../client";

export interface CreateOrderItemInput {
    variantId: string;
    quantity: number;
}

export interface CreateOrderAddressInput {
    recipient: string;
    phone?: string;
    country: string;
    region?: string;
    city?: string;
    line1: string;
    line2?: string;
    postalCode?: string;
}

export interface CreateOrderInput {
    idempotencyKey: string;
    email: string;
    customerId?: string | null;
    marketId: string;
    currency: string;
    locale?: string;
    shippingAddress: CreateOrderAddressInput;
    items: CreateOrderItemInput[];
    /** 整单运费（由上层用 computeShipping 算好后传入；变体缓存不含运费）。 */
    shippingCents: number;
    discountCents?: number;
}

export interface CreateOrderResult {
    orderId: string;
    orderNumber: string;
    totalCents: number;
}

/** 可读单号：SO-<base36 时间>-<3位随机>。 */
function genOrderNumber(): string {
    const t = Date.now().toString(36).toUpperCase();
    const r = Math.floor(Math.random() * 46656)
        .toString(36)
        .toUpperCase()
        .padStart(3, "0");
    return `SO-${t}-${r}`;
}

/**
 * 创建订单（§15 步骤 11b）。接收 Db | Tx，不自开事务——由调用方在事务里包，
 * 使"幂等占位 + 建单 + 明细 + 发 outbox 事件"原子。
 *
 * MVP 简化：单价/税/关取自 variant_market_prices（重算时 shipping=0），运费整单级另加；
 * 运费进 VAT 税基的精确化留步骤 12（Stripe Tax + LandedCost）。
 */
export async function createOrder(db: Db | Tx, input: CreateOrderInput): Promise<CreateOrderResult> {
    // 幂等：占位冲突即视为重复提交（铁律②）
    const inserted = await db
        .insert(idempotencyKeys)
        .values({
            key: input.idempotencyKey,
            scope: "checkout.create",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .onConflictDoNothing()
        .returning();
    if (inserted.length === 0) throw new Error("IDEMPOTENT_REPLAY");

    const [addr] = await db
        .insert(addresses)
        .values({
            customerId: input.customerId ?? null,
            recipient: input.shippingAddress.recipient,
            phone: input.shippingAddress.phone,
            country: input.shippingAddress.country,
            region: input.shippingAddress.region,
            city: input.shippingAddress.city,
            line1: input.shippingAddress.line1,
            line2: input.shippingAddress.line2,
            postalCode: input.shippingAddress.postalCode,
            addressType: "shipping",
        })
        .returning();
    if (!addr) throw new Error("address insert failed");

    let subtotal = 0;
    let tax = 0;
    let duty = 0;
    const built: { variantId: string; quantity: number; unitPriceCents: number; snapshot: Record<string, unknown> }[] = [];

    for (const it of input.items) {
        const price = (
            await db
                .select()
                .from(variantMarketPrices)
                .where(and(eq(variantMarketPrices.variantId, it.variantId), eq(variantMarketPrices.marketId, input.marketId)))
                .limit(1)
        )[0];
        if (!price || price.blocked) throw new Error(`NOT_SELLABLE:${it.variantId}`);
        subtotal += price.goodsCents * it.quantity;
        tax += price.taxCents * it.quantity;
        duty += price.dutyCents * it.quantity;
        built.push({
            variantId: it.variantId,
            quantity: it.quantity,
            unitPriceCents: price.goodsCents,
            snapshot: { currency: price.currency, listPriceCents: price.listPriceCents, allInCents: price.allInCents },
        });
    }

    const discount = input.discountCents ?? 0;
    const shipping = input.shippingCents;
    const total = subtotal + tax + duty + shipping - discount;

    const [order] = await db
        .insert(orders)
        .values({
            orderNumber: genOrderNumber(),
            email: input.email,
            customerId: input.customerId ?? null,
            marketId: input.marketId,
            locale: input.locale ?? "en",
            currency: input.currency,
            shippingAddressId: addr.id,
            addressSnapshot: { ...input.shippingAddress },
            subtotalCents: subtotal,
            discountCents: discount,
            shippingCents: shipping,
            taxCents: tax,
            dutyCents: duty,
            totalCents: total,
        })
        .returning();
    if (!order) throw new Error("order insert failed");

    for (const b of built) {
        const [oi] = await db
            .insert(orderItems)
            .values({
                orderId: order.id,
                variantId: b.variantId,
                quantity: b.quantity,
                unitPriceCents: b.unitPriceCents,
                snapshot: b.snapshot,
            })
            .returning();
        if (oi) {
            await db.insert(orderLines).values({ orderId: order.id, orderItemId: oi.id, type: "item", amountCents: b.unitPriceCents * b.quantity });
        }
    }
    if (shipping) await db.insert(orderLines).values({ orderId: order.id, type: "shipping", amountCents: shipping });
    if (tax) await db.insert(orderLines).values({ orderId: order.id, type: "tax", amountCents: tax });
    if (duty) await db.insert(orderLines).values({ orderId: order.id, type: "duty", amountCents: duty });
    if (discount) await db.insert(orderLines).values({ orderId: order.id, type: "discount", amountCents: -discount });

    // 首个真实写侧发 outbox 事件（cron relay 会消费）
    await emitEvent(db, {
        aggregateType: "order",
        aggregateId: order.id,
        eventType: "order.created",
        payload: { orderNumber: order.orderNumber, totalCents: total, marketId: input.marketId },
    });

    return { orderId: order.id, orderNumber: order.orderNumber, totalCents: total };
}

/** 按单号读订单 + 明细行（前台确认页用）。 */
export async function getOrderByNumber(db: Db | Tx, orderNumber: string) {
    const order = (await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1))[0];
    if (!order) return null;
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    return { order, lines };
}
