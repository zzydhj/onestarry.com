"use client";

import { useRef, useState } from "react";
import { Button } from "@onestarry/ui";
import { importProductsAction, type ImportSummary } from "./actions";

/** CSV 上传 + 导入结果报告。 */
export function ImportForm() {
    const ref = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [summary, setSummary] = useState<ImportSummary | null>(null);

    async function onSubmit() {
        const file = ref.current?.files?.[0];
        if (!file) return;
        setBusy(true);
        setSummary(null);
        try {
            const fd = new FormData();
            fd.set("file", file);
            const s = await importProductsAction(fd);
            setSummary(s);
            if (ref.current) ref.current.value = "";
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3">
                <input ref={ref} type="file" accept=".csv,text/csv" className="text-sm" />
                <Button type="button" onClick={onSubmit} disabled={busy}>
                    {busy ? "导入中…" : "开始导入"}
                </Button>
            </div>

            {summary && (
                <div className="mt-4 rounded-xl border border-line p-4 text-sm">
                    <div>
                        共 <strong>{summary.total}</strong> 行 · 新建 <strong className="text-green-700">{summary.created}</strong> ·
                        更新 <strong className="text-accent">{summary.updated}</strong> ·
                        抓图 <strong className="text-green-700">{summary.imagesImported}</strong> ·
                        失败 <strong className={summary.failed.length ? "text-red-600" : "text-muted"}>{summary.failed.length}</strong>
                    </div>
                    {summary.imageFailed.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-600">
                            {summary.imageFailed.slice(0, 20).map((f, i) => (
                                <li key={i}>图片 <code className="font-mono">{f.sku}</code>：{f.reason}</li>
                            ))}
                        </ul>
                    )}
                    {summary.failed.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-600">
                            {summary.failed.slice(0, 50).map((f, i) => (
                                <li key={i}>
                                    <code className="font-mono">{f.sku}</code>：{f.reason}
                                </li>
                            ))}
                            {summary.failed.length > 50 && <li>…（仅显示前 50 条）</li>}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
