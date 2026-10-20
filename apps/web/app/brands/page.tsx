import type { Metadata } from "next";
import Link from "next/link";
import { listAllBrands } from "@onestarry/db";
import { getDb } from "@/lib/db";

export const revalidate = 60;

export const metadata: Metadata = {
    title: "Brands",
    description: "Browse our catalog by brand.",
    alternates: { canonical: "/brands" },
};

export default async function BrandsIndexPage() {
    const brands = (await listAllBrands(getDb())).filter((b) => b.slug);
    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-brand">Brands</h1>
            {brands.length === 0 ? (
                <p className="text-sm text-muted">No brands yet.</p>
            ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {brands.map((b) => (
                        <li key={b.id}>
                            <Link
                                href={`/brands/${b.slug}`}
                                className="block rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium transition hover:border-accent hover:shadow-sm"
                            >
                                {b.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
