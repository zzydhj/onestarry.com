import { config } from "dotenv";
config({ path: "../../.env.local" });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { createDb } from "./client";
import { mediaAssets, productImages, products } from "./schema";
import { attachProductImage, deleteProductImage, listProductImages, moveProductImage } from "./queries";

/**
 * 商品图写路径冒烟（审查 L-3）。主体数据全在最外层事务内、结尾回滚，不留测试数据。
 *
 * 四条断言各自对着旧写法的一个真缺陷：
 *   A 半途失败零残留   —— 旧写法先插 media_assets 再插 product_images，第二步失败就留下无人引用的 media 行。
 *   B 同商品不重号     —— position 是「读 max 再 +1」，靠 products 行锁串行化后才不会再拿到同一个值。
 *   C 行锁真的持有     —— 换**另一条连接**往同一商品插 product_images（FK 检查取 FOR KEY SHARE）必须等锁到超时。
 *                        判据必须是**已提交**的商品：若用外层事务里未提交的父行，第二条连接会因"等父行出结果"
 *                        而阻塞，那就和有没有行锁无关了（第一版就错在这儿）。旧写法只有 FK 自带的 KEY SHARE，
 *                        与对方的 KEY SHARE 相容 ⇒ 立刻插入成功 ⇒ 这条断言变红。
 *   D 移动/删除的原子性 —— 交换两条 UPDATE 中间不得留重号；media 仍被别人引用时只能解绑且**不得**返回 r2Key。
 *
 * 运行：pnpm --filter @onestarry/db smoke:media
 */
const ROLLBACK = Symbol("rollback");

/** drizzle 把 PG 错误包成 "Failed query: …"，原始 code/message 在 cause 上 ⇒ 断言得把四层都拼进来。 */
function errText(e: unknown): string {
    const x = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return [x.message, x.code, x.cause?.message, x.cause?.code].filter(Boolean).join(" | ");
}

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置（先跑 neon env pull）");
    const db = createDb(url);
    const db2 = createDb(url); // 第二条连接：只有换会话才看得见行锁的效果
    const suffix = Date.now();

    // C 用的「已提交商品」：真并发需要一行双方都看得见的父记录，所以它必须跳出外层事务单独建、用完即删。
    const [probe] = await db.transaction(async (tx) => {
        const rows = await tx.insert(products).values({ status: "active" }).returning({ id: products.id });
        return rows;
    });
    if (!probe) throw new Error("探针商品建不出来");

    try {
        await db.transaction(async (tx) => {
            const [p1] = await tx.insert(products).values({ status: "active" }).returning();
            const [p2] = await tx.insert(products).values({ status: "active" }).returning();
            if (!p1 || !p2) throw new Error("测试商品建不出来");

            /* ---------------- B：连续登记拿到 0/1/2，不重号 ---------------- */
            const keys = ["a", "b", "c"].map((s) => `smoke-${suffix}-${s}.png`);
            for (const k of keys) {
                await attachProductImage(tx, { productId: p1.id, r2Key: k, mimeType: "image/png" });
            }
            const afterThree = await listProductImages(tx, p1.id);
            assert.deepEqual(
                afterThree.map((r) => r.position),
                [0, 1, 2],
                `三次登记应拿到 position 0/1/2，实际 ${afterThree.map((r) => r.position).join(",")}`,
            );
            console.log("✅ B：同商品连续登记 position=0/1/2（行锁内重算 max）");

            /* ---------------- A：登记半途失败，不得留下任何痕迹 ---------------- */
            const ghostKey = `smoke-${suffix}-ghost.png`;
            const ghostErr = await attachProductImage(tx, {
                productId: randomUUID(), // 形状合法但并不存在的商品
                r2Key: ghostKey,
                mimeType: "image/png",
            }).then(
                () => "",
                (e) => errText(e),
            );
            assert.match(ghostErr, /PRODUCT_NOT_FOUND/, `商品不存在必须报 PRODUCT_NOT_FOUND，实际：${ghostErr || "没报错"}`);
            const ghosts = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.r2Key, ghostKey));
            assert.equal(ghosts.length, 0, "登记失败后 media_assets 里不得留下任何行（旧写法这里会多出无人引用的孤儿）");
            assert.equal((await listProductImages(tx, p1.id)).length, 3, "内层失败只该回滚那次登记，已成功的三张图必须完好");
            console.log("✅ A：半途失败零残留（media 行随 savepoint 回滚，外层事务仍可用）");

            /* ---------------- C：行锁持续到最外层提交 ---------------- */
            await attachProductImage(tx, { productId: probe.id, r2Key: `smoke-${suffix}-lock.png`, mimeType: "image/png" });
            let blocked = "";
            try {
                await db2.transaction(async (tx2) => {
                    await tx2.execute(sql`set local lock_timeout = '2s'`);
                    const [m] = await tx2
                        .insert(mediaAssets)
                        .values({ r2Key: `smoke-${suffix}-other.png`, mimeType: "image/png" })
                        .returning();
                    await tx2.insert(productImages).values({ productId: probe.id, mediaId: m!.id, position: 99 });
                });
            } catch (e) {
                blocked = errText(e);
            }
            assert.match(
                blocked,
                /lock timeout|55P03|canceling statement/,
                `第二连接往同一商品插 product_images 必须被商品行锁挡到超时；实际：${blocked || "立刻成功 ⇒ attachProductImage 没持有行锁"}`,
            );
            assert.doesNotMatch(blocked, /set local lock_timeout/, "报的应是等锁超时本身，而不是 SET 语句自己失败");
            console.log("✅ C：登记持有 products 行锁（另一连接的同商品插入等锁到超时）");

            /* ---------------- D1：上移/下移是原子交换 ---------------- */
            const order = (rows: { r2Key: string }[]) => rows.map((r) => r.r2Key.slice(-7)).join(",");
            await moveProductImage(tx, { productId: p1.id, mediaId: afterThree[2]!.mediaId, dir: "up" });
            const moved = await listProductImages(tx, p1.id);
            assert.equal(order(moved), order([afterThree[0]!, afterThree[2]!, afterThree[1]!]), `末图上移应与前一张交换，实际 ${order(moved)}`);
            const positions = moved.map((r) => r.position);
            assert.equal(new Set(positions).size, positions.length, `移动后不得出现重号，实际 ${positions.join(",")}`);
            await moveProductImage(tx, { productId: p1.id, mediaId: moved[0]!.mediaId, dir: "up" });
            assert.equal(order(await listProductImages(tx, p1.id)), order(moved), "首图上移必须是空操作（不许把 position 搞乱）");
            console.log(`✅ D1：交换原子且不重号（现序 ${order(moved)}）`);

            /* ---------------- D2：共享 media 只解绑、不返回 r2Key ---------------- */
            const [shared] = await tx
                .insert(mediaAssets)
                .values({ r2Key: `smoke-${suffix}-shared.png`, mimeType: "image/png" })
                .returning();
            await tx.insert(productImages).values({ productId: p1.id, mediaId: shared!.id, position: 10 });
            await tx.insert(productImages).values({ productId: p2.id, mediaId: shared!.id, position: 0 });
            const unlink = await deleteProductImage(tx, { productId: p1.id, mediaId: shared!.id });
            assert.equal(unlink.r2Key, null, "media 仍被另一商品引用时不得返回 r2Key —— 上层会据此删掉别人在用的 R2 对象");
            const kept = await tx
                .select({ id: productImages.id })
                .from(productImages)
                .where(and(eq(productImages.productId, p2.id), eq(productImages.mediaId, shared!.id)));
            assert.equal(kept.length, 1, "另一个商品的引用必须原样保留");
            assert.equal((await listProductImages(tx, p1.id)).length, 3, "本商品的关联应已解除（旧写法这一步撞 FK 23503，整次删除失败）");
            const lastOut = await deleteProductImage(tx, { productId: p2.id, mediaId: shared!.id });
            assert.equal(lastOut.r2Key, `smoke-${suffix}-shared.png`, "最后一个引用解除后才该给出 r2Key，让上层去删对象");
            assert.equal(
                (await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, shared!.id))).length,
                0,
                "无人引用后 media 行应被删掉",
            );
            console.log("✅ D2：共享 media 只解绑（不返回 r2Key），最后一个引用解除后才删行并交还 r2Key");

            throw ROLLBACK;
        });
    } catch (e) {
        if (e !== ROLLBACK) throw e;
        console.log("↩ 事务已回滚（未留测试数据）");
    } finally {
        await db.delete(products).where(eq(products.id, probe.id));
    }

    // 收尾复核：本次写过的任何 media 都必须随回滚消失（证明没往生产库里落下东西）
    const residue = await db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(like(mediaAssets.r2Key, `smoke-${suffix}-%`));
    assert.equal(residue.length, 0, `回滚后库里仍留有 ${residue.length} 行本次冒烟的 media`);
    console.log(`↩ 全库复核：本次前缀 smoke-${suffix}-* 零残留`);
    console.log("✅ MEDIA SMOKE PASSED");
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
