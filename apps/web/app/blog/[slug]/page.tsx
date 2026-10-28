import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getPublishedContentBySlug, listPublishedContent } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { RichBody } from "@/components/RichBody";

export const revalidate = 60;

/**
 * 构建期枚举已发布博文，让它们走与首页/PDP 同一条已被证明稳定的写入路径。
 * 失败退化成空列表（= 回到按需 ISR）而不是抛错：少预渲染只是慢，构建变红会让所有代码上不了线。
 * 为何不能留在按需 ISR：运行时 set() 写出的条目会被判即时过期 → 恒 STALE 零缓存收益（docs/PERF.md §3）。
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
    try {
        return (await listPublishedContent(getDb(), "blog")).flatMap((r) => (r.urlSlug ? [{ slug: r.urlSlug }] : []));
    } catch (e) {
        console.error("[BlogPost] 构建期枚举 slug 失败，退化为按需 ISR：", e);
        return [];
    }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const r = await getPublishedContentBySlug(getDb(), slug);
    if (!r || !("data" in r)) return { title: "Not found" };
    return { title: r.data.title, description: r.data.excerpt ?? undefined };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const r = await getPublishedContentBySlug(getDb(), slug);
    if (!r) notFound();
    if ("redirect" in r) permanentRedirect(`/blog/${r.redirect}`); // 历史/别名 slug → 永久 308（审查 M-1）
    const post = r.data;

    return (
        <article className="mx-auto max-w-2xl px-4 py-10">
            <Link href="/blog" className="text-sm text-muted transition hover:text-accent">
                ← Blog
            </Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand">{post.title}</h1>
            {post.publishedAt && <time className="mt-2 block text-sm text-muted">{post.publishedAt.slice(0, 10)}</time>}
            <div className="mt-6">
                <RichBody doc={post.body} />
            </div>
        </article>
    );
}
