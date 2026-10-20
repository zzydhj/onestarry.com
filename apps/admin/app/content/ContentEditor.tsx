"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@onestarry/ui";
import { saveContentBodyAction } from "./actions";

/** 内容正文编辑器（Tiptap StarterKit，阶段1 不含插图）。保存 → 存 ProseMirror JSON（非 HTML）。 */
export function ContentEditor({
    contentId,
    initial,
}: {
    contentId: string;
    initial: Record<string, unknown> | null;
}) {
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");
    const editor = useEditor({
        extensions: [StarterKit],
        content: initial ?? undefined,
        editorProps: { attributes: { style: "min-height:260px; outline:none; padding:10px; line-height:1.7" } },
    });
    if (!editor) return <div className="text-sm text-muted">加载编辑器…</div>;

    async function save() {
        if (!editor) return;
        setSaving(true);
        setMsg("保存中…");
        try {
            const fd = new FormData();
            fd.set("id", contentId);
            fd.set("body", JSON.stringify(editor.getJSON()));
            await saveContentBodyAction(fd);
            setMsg("已保存");
        } catch (e) {
            setMsg(`失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setSaving(false);
        }
    }

    const btn = (label: string, run: () => void, active = false) => (
        <button
            type="button"
            onClick={run}
            className={`mr-1 rounded border px-2 py-0.5 text-xs transition ${active ? "border-accent bg-accent/10 font-semibold text-accent" : "border-line bg-surface hover:bg-gray-100"
                }`}
        >
            {label}
        </button>
    );

    return (
        <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex flex-wrap gap-1 border-b border-line p-2">
                {btn("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
                {btn("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
                {btn("S", () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
                {btn("H1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
                {btn("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
                {btn("H3", () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
                {btn("• 列表", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
                {btn("1. 列表", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
                {btn("引用", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
                {btn("分隔", () => editor.chain().focus().setHorizontalRule().run())}
            </div>
            <EditorContent editor={editor} />
            <div className="flex items-center border-t border-line p-2">
                <Button type="button" onClick={save} disabled={saving}>
                    {saving ? "保存中…" : "保存正文"}
                </Button>
                {msg && <span className="ml-2 text-sm text-muted">{msg}</span>}
            </div>
        </div>
    );
}
