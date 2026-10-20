import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPublishedContentBySlug } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { RichBody } from "@/components/RichBody";

export const revalidate = 60;

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
    if ("redirect" in r) redirect(`/blog/${r.redirect}`);
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
