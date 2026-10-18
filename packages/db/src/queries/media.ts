import { and, asc, eq } from "drizzle-orm";
import { mediaAssets, productImages } from "../schema";
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

/** 登记一张商品图：写 media_assets + 关联 product_images（按 position 排序）。 */
export async function attachProductImage(db: Db | Tx, input: AttachProductImageInput): Promise<{ mediaId: string }> {
    const [media] = await db
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
    const existing = await db
        .select({ position: productImages.position })
        .from(productImages)
        .where(eq(productImages.productId, input.productId));
    const nextPos = existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0;
    await db.insert(productImages).values({
        productId: input.productId,
        mediaId: media!.id,
        position: input.position ?? nextPos,
    });
    return { mediaId: media!.id };
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

/** 删除某商品的一张图：解除 product_images 关联 + 删 media_assets，返回 r2Key 供上层删 R2 对象。 */
export async function deleteProductImage(
    db: Db | Tx,
    input: { productId: string; mediaId: string },
): Promise<{ r2Key: string | null }> {
    const [row] = await db
        .select({ r2Key: mediaAssets.r2Key })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, input.mediaId))
        .limit(1);
    await db
        .delete(productImages)
        .where(and(eq(productImages.productId, input.productId), eq(productImages.mediaId, input.mediaId)));
    await db.delete(mediaAssets).where(eq(mediaAssets.id, input.mediaId));
    return { r2Key: row?.r2Key ?? null };
}

/** 上移/下移某张商品图：与相邻图交换 position。 */
export async function moveProductImage(
    db: Db | Tx,
    input: { productId: string; mediaId: string; dir: "up" | "down" },
): Promise<void> {
    const imgs = await db
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
    await db
        .update(productImages)
        .set({ position: b.position })
        .where(and(eq(productImages.productId, input.productId), eq(productImages.mediaId, a.mediaId)));
    await db
        .update(productImages)
        .set({ position: a.position })
        .where(and(eq(productImages.productId, input.productId), eq(productImages.mediaId, b.mediaId)));
}
