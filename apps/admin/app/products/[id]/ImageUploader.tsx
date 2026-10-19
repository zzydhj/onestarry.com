"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { downscaleImage } from "@/lib/image";
import { deleteProductImageAction, moveProductImageAction, uploadProductImageAction } from "./actions";

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

    async function move(mediaId: string, dir: "up" | "down") {
        const fd = new FormData();
        fd.set("productId", productId);
        fd.set("mediaId", mediaId);
        fd.set("dir", dir);
        await moveProductImageAction(fd);
        router.refresh();
    }

    async function remove(mediaId: string) {
        if (!window.confirm("删除这张图？")) return;
        const fd = new FormData();
        fd.set("productId", productId);
        fd.set("mediaId", mediaId);
        await deleteProductImageAction(fd);
        router.refresh();
    }

    return (
        <div>
            <div className="mb-3 flex flex-wrap gap-3">
                {images.length === 0 && <span className="text-sm text-muted">暂无图片</span>}
                {images.map((img, i) => (
                    <div key={img.mediaId} className="w-24">
                        <img
                            src={img.url}
                            alt=""
                            loading="lazy"
                            width={96}
                            height={96}
                            className="h-24 w-24 rounded border border-line object-cover"
                        />
                        <div className="mt-1 flex gap-1">
                            <button type="button" disabled={i === 0} onClick={() => move(img.mediaId, "up")} className="rounded border border-line px-2 py-0.5 text-xs transition hover:bg-surface disabled:opacity-30">↑</button>
                            <button type="button" disabled={i === images.length - 1} onClick={() => move(img.mediaId, "down")} className="rounded border border-line px-2 py-0.5 text-xs transition hover:bg-surface disabled:opacity-30">↓</button>
                            <button type="button" onClick={() => remove(img.mediaId)} className="rounded border border-line px-2 py-0.5 text-xs transition hover:bg-red-50 hover:text-red-600">✕</button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <input ref={ref} type="file" accept="image/*" className="text-sm" />
                <button type="button" onClick={onPick} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? "上传中…" : "上传（自动压图）"}
                </button>
                {msg && <span className="text-sm text-muted">{msg}</span>}
            </div>
        </div>
    );
}
