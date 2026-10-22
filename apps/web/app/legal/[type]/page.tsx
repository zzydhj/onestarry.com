import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLegalDoc, LEGAL_DOC_TYPES } from "@onestarry/db";
import { getDb } from "@/lib/db";

export const revalidate = 3600; // 法律文档极少变

/**
 * 构建期枚举**全部四类**法律文档，不管文档当时存不存在（不存在的就预渲染成“还没写”占位页，
 * 运营填完正文保存时由跨 Worker 失效通道打掉这一份）。
 *
 * 为什么非要构建期：只有 CI 构建上传的条目是健康的；`generateStaticParams` 返回 `[]` 时走“按需 ISR”，
 * 而运行时 `set()` 写回来的条目会被判即时过期 → 恒 `STALE` 且**不带 Cache-Control**
 * （每次访问都跨洋全额渲染，边缘那层也完全不存）。2026-10-22 线上实测：/legal/privacy 在
 * `HIT s-maxage=3214`（还剩 53 分钟）的情况下被失效后，连打 6 发全 STALE、再也没回过 HIT。
 * 完整证据链见 docs/PERF.md §3 与 §7。
 *
 * 本函数不连库（类型是固定集），所以也不会引入“构建期连不上库”的新风险。
 */
export function generateStaticParams(): Array<{ type: string }> {
    return LEGAL_DOC_TYPES.map((type) => ({ type }));
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
