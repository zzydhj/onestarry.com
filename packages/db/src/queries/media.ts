import { asc, eq } from "drizzle-orm";
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
    await db.insert(productImages).values({
        productId: input.productId,
        mediaId: media!.id,
        position: input.position ?? 0,
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
