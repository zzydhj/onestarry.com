import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPublishedContentBySlug, listPublishedContent } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { RichBody } from "@/components/RichBody";

// 根级单段动态路由：渲染 CMS 的 page / landing 内容（如 /about、/faq）。
// 具名段（products/categories/…/blog/legal 等）优先级更高，不会被劫持；未命中 → 404。
export const revalidate = 60;

/**
 * 与 app/ 目录下的具名段一一对应：预渲染时跳过这些名字，否则会与真路由撞同一路径。
 * ⚠ app/ 下新增顶层目录时要同步这里（漏了不会报错，只是那条 CMS 页退回按需 ISR）。
 */
const RESERVED = new Set(["account", "api", "blog", "brands", "cart", "categories", "checkout", "integration", "legal", "order", "products", "search", "signin"]);

/**
 * 构建期枚举已发布的 page / landing（同 PDP 口径：连库失败退化成空列表，不把构建变红）。
 * 留在按需 ISR 的代价见 docs/PERF.md §3：运行时 set() 写出的条目会被判即时过期 → 恒 STALE、零缓存收益。
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
    try {
        const rows = [...(await listPublishedContent(getDb(), "page")), ...(await listPublishedContent(getDb(), "landing"))];
        return rows.flatMap((r) => (r.urlSlug && !RESERVED.has(r.urlSlug) ? [{ slug: r.urlSlug }] : []));
    } catch (e) {
        console.error("[CMS page] 构建期枚举 slug 失败，退化为按需 ISR：", e);
        return [];
    }
}

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
