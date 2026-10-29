import { PrefetchLink } from "@/components/PrefetchLink";
import { getLegalDoc, LEGAL_DOC_TYPES } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { Button } from "@onestarry/ui";
import { saveLegalDocAction } from "./actions";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
    terms: "服务条款",
    privacy: "隐私政策",
    returns: "退货政策",
    withdrawal: "撤回权（EU 14 天）",
};

/** 法律文档编辑（受保护）：四类文档各一表单，正文纯文本、空行分段。 */
export default async function LegalPage() {
    const { env } = await requirePermission(PERMISSIONS.seoWrite);
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const docs = await Promise.all(
        LEGAL_DOC_TYPES.map(async (t) => ({ type: t, doc: await getLegalDoc(db, { type: t, locale: "en" }) })),
    );

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <PrefetchLink href="/" className="text-sm text-muted transition hover:text-accent">
                ← 返回概览
            </PrefetchLink>
            <h1 className="mt-2 text-xl font-semibold">法律文档</h1>
            <p className="mt-1 text-sm text-muted">
                编辑前台 <code>/legal/&lt;type&gt;</code> 正文（纯文本）。约定只有三条：空行分段；行首 <code>## </code> / <code>### </code> 是小标题；
                一个块里每行都以 <code>- </code> 开头就是列表。留空则前台显示占位提示。
            </p>
            <p className="mt-1 text-sm text-muted">
                ⚠ 保存后前台**最多 60 秒**才看得到（该路由 <code>revalidate = 60</code>，预渲染条目叫不动即时失效）—— 没立即变不是没存上。
            </p>

            <div className="mt-6 space-y-8">
                {docs.map(({ type, doc }) => (
                    <form key={type} action={saveLegalDocAction} className="border-t border-line pt-4">
                        <input type="hidden" name="type" value={type} />
                        <h2 className="text-base font-semibold">
                            {LABELS[type]}{" "}
                            <span className="text-xs font-normal text-muted">
                                /legal/{type} · {doc ? `v${doc.version}` : "未创建"}
                            </span>
                        </h2>
                        <textarea
                            name="body"
                            rows={16}
                            defaultValue={doc?.body ?? ""}
                            placeholder="在此粘贴正文…"
                            className="mt-2 w-full rounded-md border border-line px-3 py-2 font-mono text-sm"
                        />
                        <div className="mt-2">
                            <Button type="submit" size="sm">
                                保存
                            </Button>
                        </div>
                    </form>
                ))}
            </div>
        </main>
    );
}
