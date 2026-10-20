import type { Metadata } from "next";
import Link from "next/link";
import { listCategoriesWithSlug } from "@onestarry/db";
import { getDb } from "@/lib/db";

export const revalidate = 60;

export const metadata: Metadata = {
    title: "Categories",
    description: "Browse our catalog by category.",
    alternates: { canonical: "/categories" },
};

export default async function CategoriesIndexPage() {
    const cats = (await listCategoriesWithSlug(getDb())).filter((c) => c.urlSlug);
    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">Categories</h1>
            {cats.length === 0 ? (
                <p className="text-sm text-muted">No categories yet.</p>
            ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {cats.map((c) => (
                        <li key={c.id} style={{ marginLeft: (c.level - 1) * 12 }}>
                            <Link
                                href={`/categories/${c.urlSlug}`}
                                className="block rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium transition hover:border-accent hover:shadow-sm"
                            >
                                {c.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
