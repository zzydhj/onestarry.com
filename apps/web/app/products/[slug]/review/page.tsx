import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createDb, getProductById, resolveSlug } from "@onestarry/db";
import { Button, Input } from "@onestarry/ui";
import { readCustomerSession } from "@/lib/session";
import { submitReviewAction } from "./actions";

export const dynamic = "force-dynamic"; // 读客户会话，不缓存

export const metadata: Metadata = { title: "Write a review", robots: { index: false, follow: false } };

/** 发表评价页（需登录客户）：评分 + 标题 + 正文 → 提交进待审核队列。 */
export default async function ReviewFormPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const session = await readCustomerSession();
    if (!session) redirect("/signin");

    const db = createDb(session.env.HYPERDRIVE.connectionString);
    const res = await resolveSlug(db, { entityType: "product", locale: "en", slug });
    if (!res || res.status === "redirect") redirect(`/products/${slug}`);
    const p = await getProductById(db, res.entityId, "us", "en");
    if (!p) redirect(`/products/${slug}`);

    return (
        <div className="mx-auto max-w-lg px-4 py-8">
            <Link href={`/products/${slug}`} className="text-sm text-muted transition hover:text-accent">
                ← Back to product
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Write a review</h1>
            <p className="mt-1 text-sm text-muted">{p.title}</p>

            <form action={submitReviewAction} className="mt-6 space-y-4">
                <input type="hidden" name="productId" value={res.entityId} />
                <input type="hidden" name="slug" value={slug} />
                <label className="block text-sm">
                    <span className="text-muted">Rating</span>
                    <select name="rating" defaultValue="5" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent">
                        {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                                {n} star{n > 1 ? "s" : ""}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block text-sm">
                    <span className="text-muted">Title</span>
                    <Input name="title" placeholder="Sum up your experience (optional)" className="mt-1 w-full px-3 py-2" />
                </label>
                <label className="block text-sm">
                    <span className="text-muted">Review</span>
                    <textarea
                        name="body"
                        rows={5}
                        placeholder="What did you like or dislike? (optional)"
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                </label>
                <Button type="submit">Submit review</Button>
            </form>
            <p className="mt-3 text-xs text-muted">Your review will appear after moderation. Signed in as {session.email}.</p>
        </div>
    );
}
