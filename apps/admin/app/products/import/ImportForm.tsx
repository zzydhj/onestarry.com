"use client";

import { useRef, useState } from "react";
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
        <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input ref={ref} type="file" accept=".csv,text/csv" />
                <button type="button" onClick={onSubmit} disabled={busy}>
                    {busy ? "导入中…" : "开始导入"}
                </button>
            </div>

            {summary && (
                <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
                    <div>
                        共 <strong>{summary.total}</strong> 行 · 新建 <strong style={{ color: "#187a30" }}>{summary.created}</strong> ·
                        更新 <strong style={{ color: "#0366d6" }}>{summary.updated}</strong> ·
                        失败 <strong style={{ color: summary.failed.length ? "#b00000" : "#666" }}>{summary.failed.length}</strong>
                    </div>
                    {summary.failed.length > 0 && (
                        <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "#b00000" }}>
                            {summary.failed.slice(0, 50).map((f, i) => (
                                <li key={i}>
                                    <code>{f.sku}</code>：{f.reason}
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
