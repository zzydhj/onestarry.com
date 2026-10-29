import { and, asc, eq, sql } from "drizzle-orm";
import { mediaAssets, productImages, products } from "../schema";
import type { Db, Tx } from "../client";

export interface AttachProductImageInput {
    productId: string;
    r2Key: string;
    mimeType: string;
    sizeBytes?: number | null;
    width?: number | null;
    height?: number | null;
    alt?: string | null;
    position?: number;
}

/**
 * 登记一张商品图：写 media_assets + 关联 product_images（按 position 排序）。
 *
 * ⚠ 两步写必须同事务（审查 L-3）：旧写法先插 media_assets、再插 product_images，中间任何失败（商品已被删、
 *   库错、isolate 在两条语句之间被回收）都会留下**没有任何引用的 media 行**；调用方那边 R2 对象此时也已上传，
 *   于是库里和桶里各攒一份永久孤儿，而本仓没有任何清理任务会去收。
 * ⚠ position 是「读 max 再 +1」的 check-then-act：并发给同一商品传图，两边读到同一个 max → 拿到同一个 position。
 *   这里对 products 行 `SELECT ... FOR UPDATE`，把同一商品的登记串行化（与 setVariantOnHand 同口径）。
 *   传入已是 Tx 时 transaction() 走 savepoint，行锁仍持续到最外层事务提交。
 */
export async function attachProductImage(db: Db | Tx, input: AttachProductImageInput): Promise<{ mediaId: string }> {
    return db.transaction(async (tx) => {
        // 锁与存在性一次拿到：锁不到商品行就是商品不存在，比让它撞 product_images 的 FK 错误好判得多
        const [target] = await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.id, input.productId))
            .limit(1)
            .for("update");
        if (!target) throw new Error("PRODUCT_NOT_FOUND");

        const [media] = await tx
            .insert(mediaAssets)
            .values({
                kind: "image",
                r2Key: input.r2Key,
                mimeType: input.mimeType,
                sizeBytes: input.sizeBytes ?? null,
                width: input.width ?? null,
                height: input.height ?? null,
                alt: input.alt ? { en: input.alt } : null,
            })
            .returning();
        const existing = await tx
            .select({ position: productImages.position })
            .from(productImages)
            .where(eq(productImages.productId, input.productId));
        const nextPos = existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0;
        await tx.insert(productImages).values({
            productId: input.productId,
            mediaId: media!.id,
            position: input.position ?? nextPos,
        });
        return { mediaId: media!.id };
    });
}

export interface ProductImageRow {
    mediaId: string;
    r2Key: string;
    mimeType: string | null;
    position: number;
}

/** 取某商品的图片（按 position 升序）。 */
export async function listProductImages(db: Db | Tx, productId: string): Promise<ProductImageRow[]> {
    return db
        .select({
            mediaId: mediaAssets.id,
            r2Key: mediaAssets.r2Key,
            mimeType: mediaAssets.mimeType,
            position: productImages.position,
        })
        .from(productImages)
        .innerJoin(mediaAssets, eq(productImages.mediaId, mediaAssets.id))
        .where(eq(productImages.productId, productId))
        .orderBy(asc(productImages.position), asc(mediaAssets.createdAt));
}

/**
 * 删除一张商品图：解除 product_images 关联 + 删 media_assets，返回 r2Key 供上层删 R2 对象。
 *
 * ⚠ 两步同事务（审查 L-3）：旧写法先解绑再删 media，后者失败时图已从商品上消失、media 行却留着 —— 又是一个孤儿。
 * ⚠ media 与商品并非 1:1（表上没这约束，一张 media 可被多个商品引用）：旧写法直接删 media 行会撞 FK 23503，
 *   结果是**这张图永远解绑不掉**。改成「只在已无人引用时才删 media 行」，并且**只有真删掉了才返回 r2Key** ——
 *   否则上层照 r2Key 去删一个别人还在用的 R2 对象，前台就是裂图。
 */
export async function deleteProductImage(
    db: Db | Tx,
    input: { productId: string; mediaId: string },
): Promise<{ r2Key: string | null }> {
    return db.transaction(async (tx) => {
        await tx
            .delete(productImages)
            .where(and(eq(productImages.productId, input.productId), eq(productImages.mediaId, input.mediaId)));
        const [gone] = await tx
            .delete(mediaAssets)
            .where(
                and(
                    eq(mediaAssets.id, input.mediaId),
                    // 上面那次解绑在本次事务内可见，所以这里算的是「删完还剩多少引用」
                    sql`not exists (select 1 from ${productImages} pi where pi.media_id = ${input.mediaId})`,
                ),
            )
            .returning({ r2Key: mediaAssets.r2Key });
        return { r2Key: gone?.r2Key ?? null };
    });
}

/**
 * 上移/下移一张商品图：与相邻图交换 position。
 *
 * ⚠ 必须同事务 + 锁住商品行（审查 L-3）：交换是两条 UPDATE，旧写法中间窗口里两张图拿到同一个 position，
 *   而 isolate 在两条之间被回收就把这个重号**永久留在库里**（排序靠 createdAt 兜底，看上去只是“没换成”，
 *   难发现也难解释）。行锁同时挡住并发的移动/登记，与 attachProductImage 同口径。
 */
export async function moveProductImage(
    db: Db | Tx,
    input: { productId: string; mediaId: string; dir: "up" | "down" },
): Promise<void> {
    await db.transaction(async (tx) => {
        await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.id, input.productId))
            .limit(1)
            .for("update");

        const imgs = await tx
            .select({ mediaId: productImages.mediaId, position: productImages.position })
            .from(productImages)
            .where(eq(productImages.productId, input.productId))
            .orderBy(asc(productImages.position));
        const idx = imgs.findIndex((i) => i.mediaId === input.mediaId);
        if (idx < 0) return;
        const swapWith = input.dir === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= imgs.length) return;
        const a = imgs[idx]!;
        const b = imgs[swapWith]!;
        await tx
            .update(productImages)
            .set({ position: b.position })
            .where(and(eq(productImages.productId, input.productId), eq(productImages.mediaId, a.mediaId)));
        await tx
            .update(productImages)
            .set({ position: a.position })
            .where(and(eq(productImages.productId, input.productId), eq(productImages.mediaId, b.mediaId)));
    });
}
