import Link from "next/link";
import { PERMISSIONS } from "@onestarry/core";
import { listReviewsForModeration, type ReviewStatus } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ReviewList } from "./ReviewList";

export const dynamic = "force-dynamic";

const TABS: { key: ReviewStatus; label: string }[] = [
    { key: "pending", label: "待审核" },
    { key: "approved", label: "已通过" },
    { key: "rejected", label: "已拒绝" },
    { key: "flagged", label: "已标记" },
];

/** 评论审核（需 product:write）：按状态列出，逐条通过/拒绝/标记。 */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
    const { env } = await requirePermission(PERMISSIONS.productWrite);
    const { status: q } = await searchParams;
    const status: ReviewStatus = (TABS.some((t) => t.key === q) ? q : "pending") as ReviewStatus;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const rows = await listReviewsForModeration(db, status);

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">评论审核</h1>

            <div className="mt-4 flex gap-2 text-sm">
                {TABS.map((t) => (
                    <Link
                        key={t.key}
                        href={`/reviews?status=${t.key}`}
                        className={
                            t.key === status
                                ? "rounded-full bg-brand px-3 py-1 text-white"
                                : "rounded-full border border-line px-3 py-1 text-muted transition hover:text-brand"
                        }
                    >
                        {t.label}
                    </Link>
                ))}
            </div>

            <ReviewList status={status} rows={rows} />
        </main>
    );
}
