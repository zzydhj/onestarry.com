"use client";

import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { downscaleImage } from "@/lib/image";
import { saveRichBodyAction, uploadRichImageAction } from "./actions";

/** 图文详情编辑器（Tiptap StarterKit）。保存 → 存 ProseMirror JSON（非 HTML）。 */
export function RichTextEditor({
    productId,
    initial,
}: {
    productId: string;
    initial: Record<string, unknown> | null;
}) {
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");
    const imgRef = useRef<HTMLInputElement>(null);
    const editor = useEditor({
        extensions: [StarterKit, Image],
        content: initial ?? undefined,
        editorProps: { attributes: { style: "min-height:180px; outline:none; padding:8px; line-height:1.6" } },
    });
    if (!editor) return <div style={{ color: "#999", fontSize: 13 }}>加载编辑器…</div>;

    async function save() {
        if (!editor) return;
        setSaving(true);
        setMsg("保存中…");
        try {
            const fd = new FormData();
            fd.set("productId", productId);
            fd.set("body", JSON.stringify(editor.getJSON()));
            await saveRichBodyAction(fd);
            setMsg("已保存");
        } catch (e) {
            setMsg(`失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setSaving(false);
        }
    }

    async function onPickImage() {
        const file = imgRef.current?.files?.[0];
        if (!file || !editor) return;
        setMsg("插入图片中…");
        try {
            const blob = await downscaleImage(file);
            const fd = new FormData();
            fd.set("productId", productId);
            fd.set("image", new File([blob], "image.webp", { type: "image/webp" }));
            const res = await uploadRichImageAction(fd);
            if (res.error || !res.url) {
                setMsg(`插入失败：${res.error ?? "未知错误"}`);
                return;
            }
            editor.chain().focus().setImage({ src: res.url }).run();
            setMsg("图片已插入，记得点保存");
        } catch (e) {
            setMsg(`插入失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            if (imgRef.current) imgRef.current.value = "";
        }
    }

    const btn = (label: string, run: () => void, active = false) => (
        <button
            type="button"
            onClick={run}
            style={{
                marginRight: 4,
                padding: "2px 8px",
                fontWeight: active ? 700 : 400,
                background: active ? "#e8f0fe" : "#f5f5f5",
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
            }}
        >
            {label}
        </button>
    );

    return (
        <div style={{ border: "1px solid #ddd", borderRadius: 6 }}>
            <div style={{ padding: 8, borderBottom: "1px solid #eee", display: "flex", flexWrap: "wrap", gap: 2 }}>
                {btn("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
                {btn("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
                {btn("S", () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
                {btn("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
                {btn("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
                {btn("• 列表", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
                {btn("1. 列表", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
                {btn("引用", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
                {btn("分隔", () => editor.chain().focus().setHorizontalRule().run())}
                {btn("🖼 图片", () => imgRef.current?.click())}
                <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickImage} />
            </div>
            <EditorContent editor={editor} />
            <div style={{ padding: 8, borderTop: "1px solid #eee" }}>
                <button type="button" onClick={save} disabled={saving}>
                    {saving ? "保存中…" : "保存详情"}
                </button>
                {msg && <span style={{ marginLeft: 8, fontSize: 13, color: "#666" }}>{msg}</span>}
            </div>
        </div>
    );
}
