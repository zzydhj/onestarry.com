import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseLegalBlocks } from "@onestarry/core";
import { getLegalDoc, LEGAL_DOC_TYPES } from "@onestarry/db";
import { getDb } from "@/lib/db";

/**
 * 60 秒，不是 3600：法律文档“极少变”只对**读**成立，写的传播上界必须看缓存形状。
 * 2026-10-22 线上实测：构建期预渲染上传的 ISR 条目**对 revalidatePath 免疫**
 * （POST 返回 ok，但紧接 10 发穿透边缘的探测全部单调倒计时、一次 STALE 都没出现）。
 * 所以“改完可见”唯一可靠的上界就是这个窗口：留 3600 就等于“运营填完隐私政策最多要等一小时”。
 * 完整证据链与两种条目命运的对比见 docs/PERF.md §7。
 */
export const revalidate = 60;

/**
 * 构建期枚举**全部四类**法律文档，不管文档当时存不存在（不存在的就预渲染成“还没写”占位页，
 * 运营填完正文后最多等一个 `revalidate` 窗口就可见 —— 预渲染条目叫不动 revalidatePath，见上方注释）。
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
    // 正文是纯文本（库里不存 HTML），结构靠 parseLegalBlocks 的三条约定：空行分段、`## `/`### ` 标题、`- ` 列表。
    const blocks = parseLegalBlocks(doc?.body);

    return (
        <div className="mx-auto max-w-2xl px-4 py-10">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">{TITLES[type]}</h1>
            {blocks.length === 0 ? (
                <p className="mt-4 text-muted">This page hasn’t been written yet.</p>
            ) : (
                <div className="mt-4 space-y-4 text-sm leading-relaxed text-fg">
                    {blocks.map((b, i) => {
                        switch (b.kind) {
                            case "h2":
                                return (
                                    <h2 key={i} className="pt-5 text-base font-semibold tracking-tight text-brand">
                                        {b.text}
                                    </h2>
                                );
                            case "h3":
                                return (
                                    <h3 key={i} className="pt-2 text-sm font-semibold text-brand">
                                        {b.text}
                                    </h3>
                                );
                            case "ul":
                                return (
                                    <ul key={i} className="list-disc space-y-1 pl-5">
                                        {b.items.map((item, j) => (
                                            <li key={j}>{item}</li>
                                        ))}
                                    </ul>
                                );
                            default:
                                return <p key={i}>{b.text}</p>;
                        }
                    })}
                </div>
            )}
        </div>
    );
}
