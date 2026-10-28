import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { CART_MAX_LINES, CART_MAX_QTY, computeSellability, genOrderAccessToken, genOrderNumber } from "@onestarry/core";
import { inventory, orders, productVariants, products, variantMarketPrices } from "../schema";
import { uuidv7 } from "../uuid7";
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
    /** 游客访问凭证（只给结账链路，不进任何可索引页面）。 */
    publicToken: string;
    /** true = 同一个幂等键的第二次提交，返回的是原单（不是新建）。 */
    replayed: boolean;
}

/**
 * 参数包装：手内 SQL 必须给每个参数显式贴类型。
 * 原因：VALUES 列表里的参数在 Postgres 里是 unknown，列型会退化成 text，
 * 然文字面量插进 uuid/int 列并不安全。贴了 cast 就没歧义。
 */
const pUuid = (v: string): SQL => sql`${v}::uuid`;
const pTxt = (v: string | null | undefined): SQL => sql`${v ?? null}::text`;
const pInt = (v: number): SQL => sql`${v}::int`;
const pBig = (v: number): SQL => sql`${v}::bigint`;
const pJson = (v: unknown): SQL => sql`${JSON.stringify(v)}::jsonb`;
// 裸 sql 参数不会自动序列化 Date（实测报 ERR_INVALID_ARG_TYPE：The "string" argument ...）→ 手转 ISO 字符串 + cast
const pTs = (v: Date): SQL => sql`${v.toISOString()}::timestamptz`;

/**
 * 可读单号：生成逻辑已搬到 `@onestarry/core/orderNumber`（纯函数 + 单测）。
 * 旧实现是本文件里的 `Math.floor(Math.random() * 46656)`（36³）+ 3 位，熵只够被人撞；
 * 而前台确认页当时无鉴权，两者复合就是「猜单号 → 读别人邮箱与购物内容」。
 */

/**
 * 下单数量的硬校验。**不能只信 readCart**：那是应用层另一道，而 createOrder 还有
 * CSV/集成/脚本等其它调用方，金额乘法的入口必须自己把关（2026-10-23 审查的 P0-3）。
 */
function assertQuantity(variantId: string, quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > CART_MAX_QTY) {
        throw new Error(`INVALID_QTY:${variantId}:${String(quantity)}`);
    }
}

/**
 * 创建订单。**读价与金额计算全部留在 JS（与改造前逐字相同，财务口径零变化）**，
 * 然后把「幂等占位 + 地址 + 订单 + 明细 + 金额行 + outbox 事件」合成
 * **一条 data-modifying CTE**（实测旧写法 7 条串行语句本地 4386 ms，每多一条就多一次跨洋往返）。
 *
 * 为什么这样安全：
 * - 单语句天然原子（比原来的显式事务更硬），所以下游调用方不必再包 transaction。
 * - 幂等（铁律②）：`ins_key` 冲突→0 行，`ins_addr` 的 `where exists` 门控住全部后续写入，
 *   最后 `select exists(...)` 返回 false → 照旧抛 `IDEMPOTENT_REPLAY`。不可售/缺价仍在 JS 里先报错，不会进入写。
 * - 子 CTE 之间靠“读对方输出”强制排序（`from ins_addr` / `from ins_items`），FK 不会因执行顺序不确定而失败。
 * - id 必须显式给：主键默认值是应用侧 `$defaultFn(uuidv7)`，数据库没有 default，故 JS 预生成。
 * ⚠ 枚举列（address_type / order_line_type）必须写 `'x'::枚举名` 字面量：参数字贴成 ::text 后
 * 在 INSERT ... SELECT 里不会隐式转成枚举（实测报“column address_type is of type address_type but
 * expression is of type text”）。枚举名是本文件内的固定常量，无注入面。
 * 验证：`pnpm --filter @onestarry/db smoke:create-order`（总 26680、4 行求和、事件、重放拦住）。
 */
export async function createOrder(db: Db | Tx, input: CreateOrderInput): Promise<CreateOrderResult> {
    if (input.items.length === 0) throw new Error("EMPTY_ORDER");
    if (input.items.length > CART_MAX_LINES) throw new Error("TOO_MANY_LINES");
    if ((input.discountCents ?? 0) < 0) throw new Error("INVALID_DISCOUNT");

    let subtotal = 0;
    let tax = 0;
    let duty = 0;
    const built: { id: string; lineId: string; variantId: string; quantity: number; unitPriceCents: number; snapshot: Record<string, unknown> }[] = [];
    // H-2 预留快照：variantId → 本次占位量（仅 in_stock_only 行），随单写入 orders.reservation 供后续精确回退。
    const reservations: Record<string, number> = {};

    // 读价 + 可售事实：批量一次取回（代替逐变体的 N 次跨洋往返）。不可售/缺价在此拦住，不进入写入。
    // 顺手 join products.status / inventory / availability_policy / 市场禁售（黑名名单），不额外加往返（审查 H2）。
    // ❗ 只实现“黑名单”（denied）：“白名单模式”会让没有 allow 行的存量商品全判不可售 → 直接断收入，
    //   进 MVP 不安全，故 hasAllowlist 固定为 false（见 computeSellability 注释）。
    const variantIds = input.items.map((i) => i.variantId);
    const deniedSql = sql<boolean>`exists (
        select 1 from product_market_availability pma
        where pma.market_id = ${input.marketId}::uuid and pma.mode = 'deny'
          and (pma.variant_id = ${variantMarketPrices.variantId} or pma.product_id = ${productVariants.productId})
    )`;
    const prices = await db
        .select({
            variantId: variantMarketPrices.variantId,
            goodsCents: variantMarketPrices.goodsCents,
            taxCents: variantMarketPrices.taxCents,
            dutyCents: variantMarketPrices.dutyCents,
            currency: variantMarketPrices.currency,
            listPriceCents: variantMarketPrices.listPriceCents,
            allInCents: variantMarketPrices.allInCents,
            blocked: variantMarketPrices.blocked,
            productStatus: products.status,
            availabilityPolicy: productVariants.availabilityPolicy,
            available: sql<number>`coalesce(${inventory.available}, 0)::int`,
            denied: deniedSql,
        })
        .from(variantMarketPrices)
        .innerJoin(productVariants, eq(productVariants.id, variantMarketPrices.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(inventory, eq(inventory.variantId, variantMarketPrices.variantId))
        .where(and(inArray(variantMarketPrices.variantId, variantIds), eq(variantMarketPrices.marketId, input.marketId)));
    const priceMap = new Map(prices.map((p) => [p.variantId, p]));

    for (const it of input.items) {
        assertQuantity(it.variantId, it.quantity);
        const price = priceMap.get(it.variantId);
        // 单一真源：把六条事实交给 computeSellability。blocked 折成 denied（市场级封锁=该市场不可售）。
        const verdict = computeSellability({
            productStatus: price?.productStatus ?? "draft", // 无价行→当作 draft，下面 reasons 带 no_price
            marketActive: true,
            availability: { hasAllowlist: false, allowed: true, denied: price ? price.blocked || price.denied : true },
            prohibited: false,
            hasPrice: !!price,
            shipsTo: true,
            availabilityPolicy: price?.availabilityPolicy ?? "in_stock_only",
            availableQty: price?.available ?? 0,
        });
        // 库存充足性：in_stock_only 要求可售库存 >= 下单数量（computeSellability 只判 <=0 的缺货）。
        const inStockOnly = (price?.availabilityPolicy ?? "in_stock_only") === "in_stock_only";
        const shortStock = inStockOnly && (price?.available ?? 0) < it.quantity;
        if (!verdict.sellable || shortStock) {
            const reasons = shortStock ? [...verdict.reasons, "insufficient_stock" as const] : verdict.reasons;
            throw new Error(`NOT_SELLABLE:${it.variantId}:${reasons.join("|")}`);
        }
        // JS 预检（读快照）拦掉常见缺货；真正的并发安全靠下面单条 CTE 里的原子占位。
        if (inStockOnly) reservations[it.variantId] = (reservations[it.variantId] ?? 0) + it.quantity;
        subtotal += price!.goodsCents * it.quantity;
        tax += price!.taxCents * it.quantity;
        duty += price!.dutyCents * it.quantity;
        built.push({
            id: uuidv7(),
            lineId: uuidv7(),
            variantId: it.variantId,
            quantity: it.quantity,
            unitPriceCents: price!.goodsCents,
            snapshot: { currency: price!.currency, listPriceCents: price!.listPriceCents, allInCents: price!.allInCents },
        });
    }

    const discount = input.discountCents ?? 0;
    const shipping = input.shippingCents;
    const total = subtotal + tax + duty + shipping - discount;
    // 金额底线：数量已校，但运费/优惠仍可能把总额压负（负数单入库 = 账本与发票垃圾）。
    if (!Number.isSafeInteger(total) || total < 0) throw new Error(`INVALID_TOTAL:${String(total)}`);

    // 主键是应用侧默认值（库无 default），裸 SQL 拿不到 → 全预生成（行项 id 也预生，
    // 这样金额行就不依赖“插明细拿 RETURNING 再插行”那一次额外往返）
    const orderId = uuidv7();
    const orderNumber = genOrderNumber();
    const publicToken = genOrderAccessToken();
    const addrId = uuidv7();
    const keyId = uuidv7();
    const eventId = uuidv7();
    const extraLineIds = { shipping: uuidv7(), tax: uuidv7(), duty: uuidv7(), discount: uuidv7() };
    const itemTuples = sql.join(
        built.map((b) => sql`(${pUuid(b.id)}, ${pUuid(b.variantId)}, ${pInt(b.quantity)}, ${pBig(b.unitPriceCents)}, ${pJson(b.snapshot)})`),
        sql`, `,
    );
    const itemLineTuples = sql.join(built.map((b) => sql`(${pUuid(b.lineId)}, ${pUuid(b.id)})`), sql`, `);

    // H-2 预留：仅 in_stock_only 行参与，占位量记在 reservations（JS 预检已保证可见性，DB 层再原子兜底）。
    const reserveNeeded = Object.keys(reservations).length;
    const reserveTuples = sql.join(Object.entries(reservations).map(([vid, q]) => sql`(${pUuid(vid)}, ${pInt(q)})`), sql`, `);

    // 建单 + 原子占位必须在同一事务：占位不足要能把已建的单/幂等键一起回滚（否则留悬挂单或漏占位）。
    // 传入已是 Tx 时走 savepoint；Db 时开真事务（多 BEGIN/COMMIT 两趟，是资金正确性的必要代价——
    // 单条 CTE 里用 `exists(ins_key)` 门控 reserve + 跨 CTE 引用其计数，实测对 Postgres 的 CTE 求值顺序敏感、会误伤有货单）。
    return db.transaction(async (tx) => {
        const [res] = await tx.execute<{ created: boolean; order_id: string | null }>(sql`
        with ins_key as (
            insert into idempotency_keys (id, "key", scope, response_hash, expires_at)
            values (${pUuid(keyId)}, ${pTxt(input.idempotencyKey)}, ${pTxt("checkout.create")}, ${pTxt(orderId)}, ${pTs(new Date(Date.now() + 60 * 60 * 1000))})
            on conflict do nothing
            returning id
        ),
        ins_addr as (
            insert into addresses (id, customer_id, recipient, phone, country, region, city, line1, line2, postal_code, address_type)
            select ${pUuid(addrId)}, ${pTxt(input.customerId)}, ${pTxt(input.shippingAddress.recipient)}, ${pTxt(input.shippingAddress.phone)},
                   ${pTxt(input.shippingAddress.country)}, ${pTxt(input.shippingAddress.region)}, ${pTxt(input.shippingAddress.city)},
                   ${pTxt(input.shippingAddress.line1)}, ${pTxt(input.shippingAddress.line2)}, ${pTxt(input.shippingAddress.postalCode)}, 'shipping'::address_type
            where exists (select 1 from ins_key)
            returning id
        ),
        ins_order as (
            insert into orders (id, order_number, public_token, customer_id, email, market_id, locale, currency, shipping_address_id, address_snapshot,
                                subtotal_cents, discount_cents, shipping_cents, tax_cents, duty_cents, total_cents)
            select ${pUuid(orderId)}, ${pTxt(orderNumber)}, ${pTxt(publicToken)}, ${pTxt(input.customerId)}, ${pTxt(input.email)}, ${pUuid(input.marketId)},
                   ${pTxt(input.locale ?? "en")}, ${pTxt(input.currency)}, a.id, ${pJson({ ...input.shippingAddress })},
                   ${pBig(subtotal)}, ${pBig(discount)}, ${pBig(shipping)}, ${pBig(tax)}, ${pBig(duty)}, ${pBig(total)}
            from ins_addr a
            returning id
        ),
        ins_items as (
            insert into order_items (id, order_id, variant_id, quantity, unit_price_cents, snapshot)
            select v.id, o.id, v.variant_id, v.qty, v.unit_price, v.snap
            from (values ${itemTuples}) as v(id, variant_id, qty, unit_price, snap), ins_order o
            returning id, order_id, quantity, unit_price_cents
        ),
        ins_lines as (
            insert into order_lines (id, order_id, order_item_id, type, amount_cents)
            select v.lid, i.order_id, i.id, 'item'::order_line_type, i.unit_price_cents * i.quantity
            from (values ${itemLineTuples}) as v(lid, iid), ins_items i
            where i.id = v.iid
            union all
            select ${pUuid(extraLineIds.shipping)}, o.id, null, 'shipping'::order_line_type, ${pBig(shipping)} from ins_order o where ${pBig(shipping)} <> 0
            union all
            select ${pUuid(extraLineIds.tax)}, o.id, null, 'tax'::order_line_type, ${pBig(tax)} from ins_order o where ${pBig(tax)} <> 0
            union all
            select ${pUuid(extraLineIds.duty)}, o.id, null, 'duty'::order_line_type, ${pBig(duty)} from ins_order o where ${pBig(duty)} <> 0
            union all
            select ${pUuid(extraLineIds.discount)}, o.id, null, 'discount'::order_line_type, ${pBig(-discount)} from ins_order o where ${pBig(discount)} <> 0
        ),
        ins_event as (
            insert into transactional_outbox (id, aggregate_type, aggregate_id, event_type, payload)
            select ${pUuid(eventId)}, ${pTxt("order")}, o.id, ${pTxt("order.created")},
                   ${pJson({ orderNumber, totalCents: total, marketId: input.marketId })}
            from ins_order o
        )
        -- 重放时订单 id 从幂等键的 response_hash 取：orderId 在 JS 里是**预先生成**的，
        -- 所以它能随键一起写入，不需要事后回写 —— 同一语句里 UPDATE 是**看不见**刚由
        -- INSERT 插进去的那行的（Postgres 的 data-modifying CTE 共享语句开始时的快照，实测如此）。
        select exists (select 1 from ins_order) as created,
               coalesce(
                   (select o.id from ins_order o limit 1),
                   (select k.response_hash::uuid from idempotency_keys k
                     where k."key" = ${pTxt(input.idempotencyKey)} and k.scope = ${pTxt("checkout.create")})
               ) as order_id
    `);

        // 一行没写 = 幂等键已存在（铁律②）：读回原单返回，不重复占位（占位由首提那一次负责）。
        if (!res?.created) {
            const existingId = res?.order_id ?? null;
            if (existingId) {
                const [existing] = await tx.select(orderCols).from(orders).where(eq(orders.id, existingId)).limit(1);
                if (existing) {
                    return {
                        orderId: existing.id,
                        orderNumber: existing.orderNumber,
                        totalCents: existing.totalCents,
                        publicToken: existing.publicToken,
                        replayed: true,
                    };
                }
            }
            throw new Error("IDEMPOTENT_REPLAY");
        }

        // 新单：原子占位。UPDATE...WHERE 在行锁下重算可售（`on_hand - reserved >= qty`）；
        // 并发抢输（最后一件被别人占了）则更新行数 < 需要数 → 抛错，整个事务回滚（连同刚建的单与幂等键），不留悬挂。
        if (reserveNeeded > 0) {
            const got = await tx.execute<{ variant_id: string }>(sql`
                update inventory i set reserved = i.reserved + v.qty, updated_at = now()
                from (values ${reserveTuples}) as v(variant_id, qty)
                where i.variant_id = v.variant_id and i.on_hand - i.reserved >= v.qty
                returning i.variant_id
            `);
            if (got.length < reserveNeeded) throw new Error("NOT_SELLABLE:insufficient_stock");
            await tx.update(orders).set({ reservation: reservations }).where(eq(orders.id, orderId));
        }

        return { orderId, orderNumber, totalCents: total, publicToken, replayed: false };
    });
}

/** 记下 PayPal 侧订单 id（幂等复用与对账用）。传 null 表示作废重建。 */
export async function setOrderPaypalOrderId(db: Db | Tx, input: { orderId: string; paypalOrderId: string | null }): Promise<void> {
    await db.update(orders).set({ paypalOrderId: input.paypalOrderId }).where(eq(orders.id, input.orderId));
}

/**
 * orders 全列的显式选择。为什么要写出来：`db.select()` 整表不能与 `sql` 原始字段同层混用，
 * 而合并查询需要同时返回订单头 + json 子聚合；显式列表还能保持与 `select()` 完全一致的驼峰形状。
 */
export const orderCols = {
    id: orders.id,
    orderNumber: orders.orderNumber,
    publicToken: orders.publicToken,
    paypalOrderId: orders.paypalOrderId,
    status: orders.status,
    paymentStatus: orders.paymentStatus,
    fulfillmentStatus: orders.fulfillmentStatus,
    customerId: orders.customerId,
    email: orders.email,
    marketId: orders.marketId,
    locale: orders.locale,
    currency: orders.currency,
    shippingAddressId: orders.shippingAddressId,
    billingAddressId: orders.billingAddressId,
    addressSnapshot: orders.addressSnapshot,
    paymentProvider: orders.paymentProvider,
    subtotalCents: orders.subtotalCents,
    discountCents: orders.discountCents,
    shippingCents: orders.shippingCents,
    taxCents: orders.taxCents,
    dutyCents: orders.dutyCents,
    totalCents: orders.totalCents,
    refundedCents: orders.refundedCents,
    placedAt: orders.placedAt,
    notes: orders.notes,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
};

/** 订单行（金额行）的合并查询形状；`tax_rate` 是 numeric，经 JSON 可能是数字也可能是字符串。 */
export interface OrderLineRow {
    id: string;
    orderId: string;
    orderItemId: string | null;
    type: string;
    description: string | null;
    amountCents: number;
    taxRate: string | number | null;
    dutyQuoteSnapshot: unknown;
}

/** 订单商品行（带当前语言标题）。 */
export interface OrderItemRow {
    id: string;
    quantity: number;
    unitPriceCents: number;
    title: string | null;
}

/**
 * 按单号读订单 + 明细行 + 商品行（带当前标题，前台确认页用）。
 * **一条 SQL 拿齐三块**：旧写法是订单头→（行‖商品）2 步串行往返，而确认页正是用户下完单
 * 第一眼看到的页。子聚合用 json_agg + 显式驼峰键（实测 postgres-js 会把 JSON 里的 bigint 解成 number，
 * 而裸 select bigint 列会解成字符串 → 页面金额乘法出 NaN，这点已在 smoke:queries 断言）。
 * ⚠ 子查询引用外层列必须写完整限定名 "orders"."xxx"：drizzle 把列对象插进 sql 模板时只给裸
 * "id"，在子查询里就跟 oi.id / pv.id 撞成 ambiguous（实测报 42702）。
 */
export async function getOrderByNumber(db: Db | Tx, orderNumber: string) {
    const [row] = await db
        .select({
            ...orderCols,
            linesJson: sql<unknown>`coalesce((
                select json_agg(json_build_object(
                    'id', ol.id, 'orderId', ol.order_id, 'orderItemId', ol.order_item_id,
                    'type', ol.type, 'description', ol.description, 'amountCents', ol.amount_cents,
                    'taxRate', ol.tax_rate, 'dutyQuoteSnapshot', ol.duty_quote_snapshot))
                from order_lines ol where ol.order_id = "orders"."id"
            ), '[]'::json)`,
            itemsJson: sql<unknown>`coalesce((
                select json_agg(json_build_object(
                    'id', oi.id, 'quantity', oi.quantity, 'unitPriceCents', oi.unit_price_cents, 'title', pt.title))
                from order_items oi
                left join product_variants pv on pv.id = oi.variant_id
                left join product_translations pt on pt.product_id = pv.product_id and pt.locale = "orders"."locale"
                where oi.order_id = "orders"."id"
            ), '[]'::json)`,
        })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
    if (!row) return null;
    const { linesJson, itemsJson, ...order } = row;
    return { order, lines: linesJson as OrderLineRow[], items: itemsJson as OrderItemRow[] };
}
