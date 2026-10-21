"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@onestarry/ui";
import { importFromUrlAction } from "./actions";

/** 贴产品链接 → 自动抓取生成草稿 → 跳商品编辑页审核发布。 */
export function UrlImportForm() {
    const [url, setUrl] = useState("");
    const [msg, setMsg] = useState("");
    const [busy, setBusy] = useState(false);
    const router = useRouter();

    async function go() {
        setBusy(true);
        setMsg("抓取中…");
        try {
            const r = await importFromUrlAction(url);
            if (r.ok && r.productId) {
                setMsg("已生成草稿，跳转中…");
                router.push(`/products/${r.productId}`);
            } else {
                setMsg(r.error ?? "抓取失败");
            }
        } catch (e) {
            setMsg(e instanceof Error ? e.message : "抓取失败");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <div className="flex flex-wrap gap-2">
                <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="粘贴产品链接（Shopify / 品牌站 / 多数普通网站可抓）"
                    className="min-w-[16rem] flex-1"
                />
                <Button type="button" onClick={go} disabled={busy}>
                    {busy ? "抓取中…" : "抓取导入"}
                </Button>
            </div>
            {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
        </div>
    );
}
