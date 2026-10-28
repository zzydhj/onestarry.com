import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orders, productTranslations, productVariants, reviews } from "../schema";
import type { Db, Tx } from "../client";

// 审查 L-3：与 receive 路由同一约定，在入口夹 UUID 形状。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** 评价标题与正文的长度封顶（公开渲染的东西，必须有个上限）。 */
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MAX = 4000;

/**
 * 发表评价（status=pending，待审核）。verifiedPurchase 由"该客户是否有含此商品的已付订单"判定。
 * rating 越界（非 1–5）或非整数直接拒绝。
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
    // 先判整数再判区间：旧写法 `rating < 1 || rating > 5` 对 NaN **两个都是 false**，
    // 于是 NaN 一路走到整数列插入才报错 → 整个请求 500（2026-10-23 审查 P2-13）。
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return { error: "INVALID_RATING" };
    // 审查 L-3：productId 直接进 uuid 列，形状不符会撞 PG 22P02 → 整个请求 500。
    // 数据层入口先夹形状（返回 {error}，前台 M-6 通道会退回带标记）。
    if (!UUID_RE.test(input.productId)) return { error: "INVALID_PRODUCT_ID" };
    // 长度封顶：评价会公开渲染在商品页，不封顶就等于允许客户往库里塞几 MB 文本。
    const title = typeof input.title === "string" && input.title ? input.title.slice(0, REVIEW_TITLE_MAX) : null;
    const body = typeof input.body === "string" && input.body ? input.body.slice(0, REVIEW_BODY_MAX) : null;

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
            title,
            body,
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
