import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { desc } from "drizzle-orm";
import { createDb } from "./client";
import { orders } from "./schema";
import { browseProducts, getProductById, getOrderByNumber, getOrderDetail, listProductsForMarket, searchProducts } from "./queries";

/**
 * 读路径查询冒烟：验证「一条 SQL 同时拿 items + total + 首图」与「订单头 + json 子聚合」两类合并写法仍给出正确形状。
 * 断言点：① 行/标题/首图键齐全；② 金额是 number（不是 bigint 字符串，否则页面算术出 NaN）；
 * ③ 窗口总数与命中数一致；④ 空结果 total=0；⑤ 未知市场 code 必须 0 行（内联子查询不能误放行）；
 * ⑥ 订单头/行/明细/发货单一次拿齐且 Date 仍是 Date。
 * 运行：pnpm --filter @onestarry/db smoke:queries
 */
async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置");
    const db = createDb(url);

    const browse = await browseProducts(db, { marketCode: "us", locale: "en", limit: 100 });
    assert.ok(browse.items.length > 0, "应有可售商品");
    assert.equal(typeof browse.total, "number", "total 必须是数字");
    assert.equal(browse.total, browse.items.length, "单页时窗口总数应等于行数");
    assert.ok(browse.items.every((i) => typeof i.title === "string" && i.title.length > 0), "title 必须非空");
    assert.ok(browse.items.every((i) => "imageUrl" in i), "每行必须带 imageUrl 键");
    assert.equal(typeof browse.items[0]?.priceCents, "number", "priceCents 必须是 number");
    console.log(`✅ 列表：${browse.items.length} 行，首行 ${browse.items[0]?.title}（图 ${browse.items[0]?.imageUrl ? "有" : "无"}）`);

    const hit = await searchProducts(db, { marketCode: "us", locale: "en", q: "mug", limit: 60 });
    assert.ok(hit.items.length > 0, "mug 应命中");
    assert.equal(hit.total, hit.items.length, "搜索窗口总数应等于命中数");
    const miss = await searchProducts(db, { marketCode: "us", locale: "en", q: "zzzqqqxx", limit: 60 });
    assert.equal(miss.items.length, 0, "乱码词不该有行");
    assert.equal(miss.total, 0, "无命中时 total 必须为 0（不是 undefined）");
    console.log(`✅ 搜索：命中 ${hit.items.length} / 无命中 ${miss.items.length}（total=${miss.total}）`);

    const detail = await getProductById(db, browse.items[0]!.productId, "us", "en");
    assert.ok(detail, "详情应命中");
    assert.equal(typeof detail.priceCents, "number");
    assert.equal(typeof detail.available, "number", "库存缺失应归 0 而不是 null");
    console.log(`✅ 详情：${detail.title} 价 ${detail.priceCents} 可售 ${detail.available}`);

    const home = await listProductsForMarket(db, "us", "en");
    assert.equal(home.length, browse.items.length, "首页与列表同源，行数应一致");

    const unknownMarket = await browseProducts(db, { marketCode: "no-such-market", locale: "en", limit: 10 });
    assert.equal(unknownMarket.items.length, 0, "未知市场必须 0 行（不能误返回别家价格）");
    assert.equal(unknownMarket.total, 0);
    console.log("✅ 未知市场短路 0 行");

    // —— 订单域合并查询（前台确认页 / 后台详情页）——
    const anyOrder = (await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).orderBy(desc(orders.createdAt)).limit(1))[0];
    if (!anyOrder) {
        console.log("⚠ 库里没有订单，跳过订单合并查询断言");
    } else {
        const byNumber = await getOrderByNumber(db, anyOrder.orderNumber);
        assert.ok(byNumber, "按单号应查到");
        assert.ok(byNumber.order.createdAt instanceof Date, "订单头 created_at 必须是 Date");
        assert.ok(byNumber.items.length > 0, "商品行不能为空数组");
        assert.equal(typeof byNumber.items[0]!.unitPriceCents, "number", "明细单价必须是 number");
        assert.ok(byNumber.order.totalCents > 0);
        const lineSum = byNumber.lines.reduce((s2, l) => s2 + l.amountCents, 0);
        assert.equal(lineSum, byNumber.order.totalCents, "金额行求和应等于总额");
        console.log(`✅ 确认页一条查：${byNumber.order.orderNumber} items=${byNumber.items.length} lines=${byNumber.lines.length} 求和=${lineSum}`);

        const detail = await getOrderDetail(db, anyOrder.id);
        assert.ok(detail, "后台详情应查到");
        assert.equal(detail.order.id, anyOrder.id);
        assert.ok(detail.items.every((i) => typeof i.quantity === "number"), "quantity 必须是 number");
        assert.ok(detail.lines.length > 0, "金额行应存在");
        console.log(`✅ 后台详情一条查：items=${detail.items.length} lines=${detail.lines.length} shipment=${detail.shipment ? detail.shipment.status : "无"}`);

        const missing = await getOrderByNumber(db, "SO-NOT-EXIST-000");
        assert.equal(missing, null, "查不到必须返回 null（确认页靠它走 notFound）");
        console.log("✅ 不存在的单号返回 null");
    }

    console.log("\n✅ QUERY SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
