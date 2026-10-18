"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { downscaleImage } from "@/lib/image";
import { uploadProductImageAction } from "./actions";

export function ImageUploader({
    productId,
    images,
}: {
    productId: string;
    images: { mediaId: string; url: string }[];
}) {
    const ref = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");

    async function onPick() {
        const file = ref.current?.files?.[0];
        if (!file) return;
        setBusy(true);
        setMsg("处理中…");
        try {
            const blob = await downscaleImage(file);
            const fd = new FormData();
            fd.set("productId", productId);
            fd.set("image", new File([blob], "image.webp", { type: "image/webp" }));
            await uploadProductImageAction(fd);
            if (ref.current) ref.current.value = "";
            setMsg("已上传");
            router.refresh();
        } catch (e) {
            setMsg(`失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {images.length === 0 && <span style={{ color: "#999", fontSize: 13 }}>暂无图片</span>}
                {images.map((img) => (
                    <img
                        key={img.mediaId}
                        src={img.url}
                        alt=""
                        loading="lazy"
                        width={96}
                        height={96}
                        style={{ width: 96, height: 96, objectFit: "cover", border: "1px solid #ddd", borderRadius: 4 }}
                    />
                ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input ref={ref} type="file" accept="image/*" />
                <button type="button" onClick={onPick} disabled={busy}>
                    {busy ? "上传中…" : "上传（自动压图）"}
                </button>
                {msg && <span style={{ fontSize: 13, color: "#666" }}>{msg}</span>}
            </div>
        </div>
    );
}
