import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPublishedContentBySlug } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { RichBody } from "@/components/RichBody";

// 根级单段动态路由：渲染 CMS 的 page / landing 内容（如 /about、/faq）。
// 具名段（products/categories/…/blog/legal 等）优先级更高，不会被劫持；未命中 → 404。
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const r = await getPublishedContentBySlug(getDb(), slug);
    if (!r || !("data" in r)) return { title: "Not found" };
    return { title: r.data.title, description: r.data.excerpt ?? undefined };
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const r = await getPublishedContentBySlug(getDb(), slug);
    if (!r) notFound();
    if ("redirect" in r) redirect(`/${r.redirect}`);
    const item = r.data;
    if (item.type === "blog") redirect(`/blog/${item.slug}`); // 博客统一走 /blog 前缀，避免根路径重复可达

    return (
        <article className="mx-auto max-w-2xl px-4 py-10">
            <h1 className="text-3xl font-semibold tracking-tight text-brand">{item.title}</h1>
            <div className="mt-6">
                <RichBody doc={item.body} />
            </div>
        </article>
    );
}
