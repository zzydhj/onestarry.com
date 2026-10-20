import type { Metadata } from "next";
import Link from "next/link";
import { listPublishedContent } from "@onestarry/db";
import { getDb } from "@/lib/db";

// 整页 ISR：与首页/PDP 同级，构建期用 DATABASE_URL 预渲染、运行期 60s 后台刷新。
export const revalidate = 60;

export const metadata: Metadata = {
    title: "Blog",
    description: "Guides, stories and updates from our team.",
    alternates: { canonical: "/blog" },
};

export default async function BlogIndex() {
    const posts = (await listPublishedContent(getDb(), "blog")).filter((p) => p.urlSlug);

    return (
        <main className="mx-auto max-w-3xl px-4 py-10">
            <h1 className="text-3xl font-semibold tracking-tight text-brand">Blog</h1>
            <p className="mt-2 text-muted">Guides, stories and updates from our team.</p>

            {posts.length === 0 ? (
                <p className="mt-8 text-muted">No posts yet — check back soon.</p>
            ) : (
                <ul className="mt-8 space-y-6">
                    {posts.map((p) => (
                        <li key={p.id} className="border-b border-line pb-6">
                            <Link href={`/blog/${p.urlSlug}`} className="group">
                                <h2 className="text-xl font-semibold text-brand transition group-hover:text-accent">{p.title}</h2>
                            </Link>
                            {p.excerpt && <p className="mt-1 text-sm text-muted">{p.excerpt}</p>}
                            {p.publishedAt && <time className="mt-2 block text-xs text-muted">{p.publishedAt.slice(0, 10)}</time>}
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
