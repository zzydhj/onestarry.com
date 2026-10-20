import Link from "next/link";
import { PERMISSIONS } from "@onestarry/core";
import { createDb, listReviewsForModeration, type ReviewStatus } from "@onestarry/db";
import { requirePermission } from "@/lib/auth";
import { Button } from "@onestarry/ui";
import { moderateReviewAction } from "./actions";

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
    const db = createDb(env.HYPERDRIVE.connectionString);
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

            <div className="mt-5 space-y-3">
                {rows.length === 0 ? (
                    <p className="text-sm text-muted">该状态下暂无评论。</p>
                ) : (
                    rows.map((r) => (
                        <div key={r.id} className="rounded-xl border border-line bg-white p-4">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-brand">
                                    {r.productTitle ?? "（未知商品）"} · {r.rating}★
                                    {r.verifiedPurchase && <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs text-accent ring-1 ring-line">已购</span>}
                                </div>
                                <span className="text-xs text-muted">{r.createdAt.toISOString().slice(0, 10)}</span>
                            </div>
                            {r.title && <div className="mt-1 text-sm">{r.title}</div>}
                            {r.body && <div className="mt-1 text-sm text-muted">{r.body}</div>}
                            <div className="mt-3 flex gap-2">
                                {(["approved", "rejected", "flagged"] as ReviewStatus[]).map((s) => (
                                    <form key={s} action={moderateReviewAction}>
                                        <input type="hidden" name="id" value={r.id} />
                                        <input type="hidden" name="status" value={s} />
                                        <Button type="submit" variant={s === "approved" ? "primary" : "secondary"} size="sm">
                                            {s === "approved" ? "通过" : s === "rejected" ? "拒绝" : "标记"}
                                        </Button>
                                    </form>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </main>
    );
}
