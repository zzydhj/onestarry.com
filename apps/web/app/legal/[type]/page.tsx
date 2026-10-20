import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLegalDoc, LEGAL_DOC_TYPES } from "@onestarry/db";
import { getDb } from "@/lib/db";

export const revalidate = 3600; // 法律文档极少变
export async function generateStaticParams() {
    return [];
}

const TITLES: Record<string, string> = {
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    returns: "Return Policy",
    withdrawal: "Right of Withdrawal",
};

function isLegalType(t: string): t is (typeof LEGAL_DOC_TYPES)[number] {
    return (LEGAL_DOC_TYPES as readonly string[]).includes(t);
}

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
    const { type } = await params;
    const title = TITLES[type] ?? "Legal";
    return { title, alternates: { canonical: `/legal/${type}` } };
}

export default async function LegalPage({ params }: { params: Promise<{ type: string }> }) {
    const { type } = await params;
    if (!isLegalType(type)) notFound();
    const doc = await getLegalDoc(getDb(), { type, locale: "en" });
    const paras = (doc?.body ?? "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

    return (
        <div className="mx-auto max-w-2xl px-4 py-10">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">{TITLES[type]}</h1>
            {paras.length === 0 ? (
                <p className="mt-4 text-muted">This page hasn’t been written yet.</p>
            ) : (
                <div className="mt-4 space-y-4 text-sm leading-relaxed text-fg">
                    {paras.map((p, i) => (
                        <p key={i}>{p}</p>
                    ))}
                </div>
            )}
        </div>
    );
}
