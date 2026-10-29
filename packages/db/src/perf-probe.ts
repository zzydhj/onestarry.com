import { config } from "dotenv";
config({ path: "../../.env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, desc, eq } from "drizzle-orm";
import * as schema from "./schema/index";
import { inventory, legalEntities, markets, orderItems, orderLines, orders, products, productVariants, shipments } from "./schema";
import { createOrder, recomputeVariantMarketPrice, type RecomputeInput } from "./queries";

/**
 * 连接/查询手感探针（只读，不改数据）。用来把"该用哪种手法"从猜变成量：
 * ① 冷连接（每请求新建 client）要付多少；② 单连接 max:1 上 Promise.all 到底是不是真并行；
 * ③ 多连接 max:3 是否值得（多几次握手）；④ 三表分三次查 vs 合成一条 json_agg 差多少；
 * ⑤ json_agg 的列别名经 postgres-js + drizzle casing 后长什么样（决定代码怎么写）；
 * ⑥ 真实页面读路径：串行 / Promise.all / 合成一条（同一 max:1 连接）；
 * ⑦ 下单写路径 createOrder 的真实耗时（事务内跑完再 ROLLBACK，不留数据）；
 * ⑧ 两个**独立** client（各 max:1）串行 vs 并行 —— 结账 action 的真实形状。
 * 运行：pnpm --filter @onestarry/db perf:probe
 * 注意：本地直连 Neon（非 Hyperdrive），RTT 与线上一致但少一层代理开销。
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? "";
if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");

// 毫秒级足够：这段量测的是百毫秒级往返，不需要 hrtime 的精度
const now = () => Date.now();
const sum = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0));

function makeDb(max: number) {
    const sql = postgres(url, { prepare: false, max });
    return { sql, db: drizzle(sql, { schema, casing: "snake_case" }) };
}

/** 取一个真实订单 id（后面几种写法都要它）。 */
async function pickOrderId(db: ReturnType<typeof makeDb>["db"]): Promise<string | null> {
    const o = await db.select({ id: orders.id }).from(orders).orderBy(desc(orders.createdAt)).limit(1);
    return o[0]?.id ?? null;
}

/** 一次"页面级"读路径：市场 + 最近订单 + 该订单三张子表（模拟后台订单详情/前台确认页）。 */
async function readPath(db: ReturnType<typeof makeDb>["db"]) {
    const m = await db.select({ id: markets.id }).from(markets).where(eq(markets.code, "us")).limit(1);
    const o = await db.select({ id: orders.id }).from(orders).orderBy(desc(orders.createdAt)).limit(1);
    const oid = o[0]?.id;
    if (!oid) return { m, rest: 0 };
    const items = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, oid));
    const lines = await db.select({ id: orderLines.id }).from(orderLines).where(eq(orderLines.orderId, oid));
    const ship = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.orderId, oid));
    return { m, count: items.length + lines.length + ship.length };
}

async function main() {
    console.log(`目标库：${new URL(url).hostname}\n`);

    // ① 冷连接：新建 client 后第一条查询的耗时（= TCP+TLS+认证 的总代价）
    const cold: number[] = [];
    const warm2nd: number[] = [];
    for (let i = 0; i < 3; i++) {
        const { sql: pool, db } = makeDb(1);
        const t = now();
        await db.execute(sql`select 1`);
        cold.push(now() - t);
        const t2 = now();
        await db.execute(sql`select 1`);
        warm2nd.push(now() - t2);
        await pool.end();
    }
    console.log(`① 新建 client 的首条查询：${cold.join(" / ")} ms（= 握手+认证的代价）`);
    console.log(`   同一 client 的第 2 条：${warm2nd.join(" / ")} ms（= 纯一次往返）→ 握手占 ${Math.round((sum(cold) - sum(warm2nd)) / cold.length)} ms/请求`);

    // ② 同一 max:1 连接上：串行 5 条 vs Promise.all 5 条
    {
        const { sql: pool, db } = makeDb(1);
        await db.execute(sql`select 1`); // 先热身，排除冷连接
        const s: number[] = [];
        for (let i = 0; i < 5; i++) {
            const t = now();
            await db.execute(sql`select 1`);
            s.push(now() - t);
        }
        const serial = sum(s);
        const t = now();
        await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
        const par = now() - t;
        console.log(`\n② max:1 单连接：串行 5 条 = ${serial} ms | Promise.all 5 条 = ${par} ms`);
        console.log(`   → ${par > serial * 0.8 ? "并行≈串行（单连接把查询排成队，Promise.all 省不了 RTT）" : "并行显著更快（单连接确有并发收益）"}`);
        await pool.end();
    }

    // ③ max:3 多连接上的 Promise.all（多连接要额外握手，看是否值回票价）
    {
        const { sql: pool, db } = makeDb(3);
        await db.execute(sql`select 1`);
        await Promise.all(Array.from({ length: 3 }, () => db.execute(sql`select 1`))); // 把连接池撑开
        const t = now();
        await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
        console.log(`\n③ max:3 多连接：Promise.all 5 条 = ${now() - t} ms（含新开连接的握手）`);
        await pool.end();
    }

    // ④ 真实读路径：5 次往返（串行）vs 1 次 json_agg 合并
    const runs = 3;
    const serial: number[] = [];
    const merged: number[] = [];
    for (let i = 0; i < runs; i++) {
        const { sql: pool, db } = makeDb(1);
        await readPath(db); // 热身
        const t1 = now();
        await readPath(db);
        serial.push(now() - t1);

        const t2 = now();
        const rows = await db.execute<{ order_id: string; items: unknown; lines: unknown; shipment: unknown; itemsJson: unknown }>(
            sql`select o.id as order_id,
                       (select coalesce(json_agg(i.*), '[]'::json) from order_items i where i.order_id = o.id)            as items,
                       (select coalesce(json_agg(l.*), '[]'::json) from order_lines l where l.order_id = o.id)            as lines,
                       (select to_jsonb(s) - 'id' from shipments s where s.order_id = o.id)                             as shipment,
                       (select coalesce(json_agg(i.*), '[]'::json) from order_items i where i.order_id = o.id)             as "itemsJson"
                 from orders o order by o.created_at desc limit 1`,
        );
        merged.push(now() - t2);
        if (i === 0) {
            const r = rows[0];
            console.log(`\n⑤ 合并查询的返回列名：${Object.keys(r ?? {}).join(", ")}`);
            console.log(`   items 是否已被 postgres-js 解析成数组：${Array.isArray(r?.items)}（长度 ${(r?.items as unknown[])?.length ?? 0}）`);
            console.log(`   驼峰别名是否保留："itemsJson" in row = ${Boolean(r && "itemsJson" in r)}；snake 键存在 = ${Boolean(r && "itemsjson" in r)}`);
        }
        await pool.end();
    }
    console.log(`\n④ 后台订单详情读路径（${runs} 次取平均）：5 条串行 = ${Math.round(sum(serial) / runs)} ms | 合成 1 条 json_agg = ${Math.round(sum(merged) / runs)} ms`);
    console.log(`   → 合并省 ${Math.round((sum(serial) - sum(merged)) / runs)} ms/页`);

    // ⑥ 真实页面读路径的三种写法（同一 max:1 连接）：串行 / Promise.all 并行 / 合成 1 条
    {
        const { sql: pool, db } = makeDb(1);
        const oid = await pickOrderId(db);
        if (!oid) {
            console.log("\n⑥ 跳过（库里没有订单）");
        } else {
            await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, oid)); // 热身
            const t1 = now();
            await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, oid));
            await db.select({ id: orderLines.id }).from(orderLines).where(eq(orderLines.orderId, oid));
            await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.orderId, oid));
            const pSerial = now() - t1;

            const t2 = now();
            await Promise.all([
                db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, oid)),
                db.select({ id: orderLines.id }).from(orderLines).where(eq(orderLines.orderId, oid)),
                db.select({ id: shipments.id }).from(shipments).where(eq(shipments.orderId, oid)),
            ]);
            const pPar = now() - t2;

            const t3 = now();
            await db.execute(sql`select
                (select coalesce(json_agg(x), '[]'::json) from (select id from order_items where order_id = ${oid}) x) as items,
                (select coalesce(json_agg(y), '[]'::json) from (select id from order_lines where order_id = ${oid}) y) as lines,
                (select to_jsonb(z) from (select id from shipments where order_id = ${oid} limit 1) z) as shipment`);
            const pMerge = now() - t3;

            console.log(`\n⑥ 三表读（同一 max:1 连接）：串行 3 条 = ${pSerial} ms | Promise.all 3 条 = ${pPar} ms | 合成 1 条 = ${pMerge} ms`);
            console.log(`   → 并行已能吃到绝大部分收益（差 ${pSerial - pPar} ms），合并只再省 ${pPar - pMerge} ms`);
        }
        await pool.end();
    }

    // ⑦ 真实下单写路径基线：事务内跑 createOrder，然后 ROLLBACK（不留数据）。
    // 这是“按下 Place order 之后”那一段：旧写法是事务里 7 条语句串行等待，每多一条就多一次跨洋往返。
    {
        const ROLLBACK = Symbol("rollback");
        const { sql: pool, db } = makeDb(1);
        const runs = 3;
        const times: number[] = [];
        for (let i = 0; i < runs; i++) {
            const suffix = `${Date.now()}-${i}`;
            try {
                await db.transaction(async (tx) => {
                    const [le] = await tx.insert(legalEntities).values({ jurisdiction: "US", displayName: `PB LE ${suffix}` }).returning();
                    const [mk] = await tx.insert(markets).values({ code: `pb_${suffix}`, name: "PB Mkt", currency: "USD", legalEntityId: le!.id }).returning();
                    const [prod] = await tx.insert(products).values({ status: "active" }).returning();
                    const [variant] = await tx.insert(productVariants).values({ productId: prod!.id, sku: `PB-${suffix}`, basePriceCents: 10000, baseCurrency: "USD" }).returning();
                    // createOrder 现在校库存（in_stock_only 需可售库存≥数量）→ 补一行库存，否则下单被挡、探针取不到基线。
                    await tx.insert(inventory).values({ variantId: variant!.id, onHand: 100, reserved: 0 });
                    const priceInput: RecomputeInput = {
                        variantId: variant!.id, marketId: mk!.id, basePriceCents: 10000, baseCurrency: "USD",
                        fxRate: 1, marketCurrency: "USD", shippingCents: 0, taxRate: 0.19, dutyRate: 0.1,
                        pricingMode: "fixed_gross", dutyPresentation: "included_in_price", thresholdCents: 15000, overThresholdPolicy: "block",
                    };
                    await recomputeVariantMarketPrice(tx, priceInput);

                    const t = now(); // 只量下单本身（建市场/变体/价格属准备段，不算在用户等待里）
                    const res = await createOrder(tx, {
                        idempotencyKey: `pb-${suffix}`,
                        email: "buyer@example.com",
                        marketId: mk!.id,
                        shippingAddress: { recipient: "Jane Doe", line1: "1 Main St", country: "US" },
                        items: [{ variantId: variant!.id, quantity: 2 }],
                        shippingCents: 500,
                    });
                    times.push(now() - t);
                    assertOrderTotal(res.totalCents);
                    throw ROLLBACK;
                });
            } catch (e) {
                if (e !== ROLLBACK) throw e;
            }
        }
        console.log(`\n⑦ 下单写路径 createOrder（事务内、回滚）：${times.join(" / ")} ms，平均 ${Math.round(sum(times) / times.length)} ms`);
        console.log("   → 这就是用户按下 Place order 后要等的那段（未含回源/冷连接）");
        await pool.end();
    }

    // ⑧ 两个**独立** client（各 max:1）串行 vs 并行 —— 这才是结账 action 的真实形状：
    //    会话走 better-auth 自己的 client、市场查找走请求内 db，是两个连接。⑥ 只证明了
    //    「同一连接上 Promise.all 无效」，跨连接能不能真重叠必须单独量（没测就不写进文档）。
    {
        const a = makeDb(1);
        const b = makeDb(1);
        await a.db.execute(sql`select 1`);
        await b.db.execute(sql`select 1`); // 两边各自先握手，别把建连时间算进对比
        const qA = () => a.db.select({ id: markets.id }).from(markets).where(eq(markets.code, "us")).limit(1);
        const qB = () => b.db.select({ id: orders.id }).from(orders).orderBy(desc(orders.createdAt)).limit(1);
        const ser: number[] = [];
        const par: number[] = [];
        for (let i = 0; i < 4; i++) {
            let t = now();
            await qA();
            await qB();
            ser.push(now() - t);
            t = now();
            await Promise.all([qA(), qB()]);
            par.push(now() - t);
        }
        console.log(`\n⑧ 两个独立 client（各 max:1）：串行 = ${sum(ser)} ms（${ser.join("/")}）| 并行 = ${sum(par)} ms（${par.join("/")}）`);
        console.log(
            `   → ${sum(par) < sum(ser) * 0.8 ? "并行真能重叠（跨连接才有收益；⑥ 的单连接结论不适用于此）" : "并行没吃到收益（瓶颈不在并发度上，不值得为它改写）"}，差 ${sum(ser) - sum(par)} ms`,
        );
        await a.sql.end();
        await b.sql.end();
    }
}

/** 下单金额护栏（与 smoke:create-order 同源）：2 件 ×10000 + 税 4180 + 关 2000 + 运费 500。 */
function assertOrderTotal(totalCents: number) {
    if (totalCents !== 26680) throw new Error(`下单总额应 26680，实际 ${totalCents}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
