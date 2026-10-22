import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orders, productTranslations, productVariants, reviews } from "../schema";
import type { Db, Tx } from "../client";

export type ReviewStatus = "pending" | "approved" | "rejected" | "flagged";

export interface ReviewItem {
    id: string;
    rating: number;
    title: string | null;
    body: string | null;
    author: string; // 脱敏展示名，绝不暴露 customerId
    verifiedPurchase: boolean;
    ownerReply: string | null;
    createdAt: Date;
}

/** 某商品已通过评论（时间倒序）+ 平均分 + 计数。前台 PDP 用。 */
export async function listApprovedReviews(
    db: Db | Tx,
    productId: string,
    locale = "en",
): Promise<{ items: ReviewItem[]; avg: number; count: number }> {
    const rows = await db
        .select()
        .from(reviews)
        .where(and(eq(reviews.productId, productId), eq(reviews.status, "approved"), eq(reviews.locale, locale)))
        .orderBy(desc(reviews.createdAt));
    const items: ReviewItem[] = rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author: r.verifiedPurchase ? "Verified Buyer" : "Customer",
        verifiedPurchase: r.verifiedPurchase,
        ownerReply: r.ownerReply,
        createdAt: r.createdAt,
    }));
    const avg = items.length ? Math.round((items.reduce((s, i) => s + i.rating, 0) / items.length) * 10) / 10 : 0;
    return { items, avg, count: items.length };
}

/**
 * 发表评价（status=pending，待审核）。verifiedPurchase 由"该客户是否有含此商品的已付订单"判定。
 * rating 越界（非 1–5）直接拒绝。
 */
export async function createReview(
    db: Db | Tx,
    input: {
        productId: string;
        variantId?: string | null;
        customerId?: string | null;
        rating: number;
        title?: string | null;
        body?: string | null;
        locale?: string;
    },
): Promise<{ id: string } | { error: string }> {
    if (input.rating < 1 || input.rating > 5) return { error: "INVALID_RATING" };

    let verified = false;
    if (input.customerId) {
        const hit = await db
            .select({ one: sql`1 as one` })
            .from(orders)
            .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
            .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
            .where(
                and(
                    eq(orders.customerId, input.customerId),
                    eq(productVariants.productId, input.productId),
                    inArray(orders.status, ["paid", "completed"]),
                ),
            )
            .limit(1);
        verified = hit.length > 0;
    }

    const inserted = await db
        .insert(reviews)
        .values({
            productId: input.productId,
            variantId: input.variantId ?? null,
            customerId: input.customerId ?? null,
            rating: input.rating,
            title: input.title ?? null,
            body: input.body ?? null,
            locale: input.locale ?? "en",
            verifiedPurchase: verified,
            status: "pending",
        })
        .returning({ id: reviews.id });
    return { id: inserted[0]!.id };
}

export interface ReviewModerationRow {
    id: string;
    productId: string;
    productTitle: string | null;
    rating: number;
    title: string | null;
    body: string | null;
    verifiedPurchase: boolean;
    status: ReviewStatus;
    createdAt: Date;
}

/** 后台审核列表（默认 pending，join 商品英文名）。 */
export async function listReviewsForModeration(db: Db | Tx, status: ReviewStatus = "pending"): Promise<ReviewModerationRow[]> {
    const rows = await db
        .select({
            id: reviews.id,
            productId: reviews.productId,
            rating: reviews.rating,
            title: reviews.title,
            body: reviews.body,
            verifiedPurchase: reviews.verifiedPurchase,
            status: reviews.status,
            createdAt: reviews.createdAt,
            productTitle: productTranslations.title,
        })
        .from(reviews)
        .leftJoin(productTranslations, and(eq(productTranslations.productId, reviews.productId), eq(productTranslations.locale, "en")))
        .where(eq(reviews.status, status))
        .orderBy(desc(reviews.createdAt));
    return rows as ReviewModerationRow[];
}

/** 审核：改状态（approve/reject/flag）。 */
export async function setReviewStatus(db: Db | Tx, reviewId: string, status: ReviewStatus): Promise<string | null> {
    // 把 productId 带回去：审核完评论要失效那件商品的详情页（评论列表是 PDP 的一部分）。
    const [row] = await db
        .update(reviews)
        .set({ status, updatedAt: new Date() })
        .where(eq(reviews.id, reviewId))
        .returning({ productId: reviews.productId });
    return row?.productId ?? null;
}
