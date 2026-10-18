import type { ReactNode } from "react";
import { mediaUrl } from "@onestarry/core";

/** ProseMirror 文档节点（宽松类型，未知节点安全跳过）。 */
interface PMNode {
    type?: string;
    text?: string;
    marks?: { type: string; attrs?: Record<string, unknown> }[];
    content?: PMNode[];
    attrs?: Record<string, unknown>;
}

/** 把 Tiptap/ProseMirror JSON 渲染成 React 元素（逐块、结构化，不注入原始 HTML）。 */
export function RichBody({ doc }: { doc: unknown }) {
    if (!doc || typeof doc !== "object") return null;
    const root = doc as PMNode;
    if (root.type !== "doc" || !Array.isArray(root.content)) return null;
    return <div style={{ lineHeight: 1.7 }}>{renderNodes(root.content, "d")}</div>;
}

function renderNodes(nodes: PMNode[], keyBase: string): ReactNode[] {
    return nodes.map((n, i) => renderNode(n, `${keyBase}-${i}`));
}

function renderNode(n: PMNode, key: string): ReactNode {
    switch (n.type) {
        case "paragraph":
            return <p key={key}>{renderNodes(n.content ?? [], key)}</p>;
        case "heading": {
            const level = Number(n.attrs?.level ?? 1);
            const kids = renderNodes(n.content ?? [], key);
            if (level <= 1) return <h1 key={key}>{kids}</h1>;
            if (level === 2) return <h2 key={key}>{kids}</h2>;
            if (level === 3) return <h3 key={key}>{kids}</h3>;
            return <h4 key={key}>{kids}</h4>;
        }
        case "bulletList":
            return <ul key={key}>{renderNodes(n.content ?? [], key)}</ul>;
        case "orderedList":
            return <ol key={key}>{renderNodes(n.content ?? [], key)}</ol>;
        case "listItem":
            return <li key={key}>{renderNodes(n.content ?? [], key)}</li>;
        case "blockquote":
            return <blockquote key={key}>{renderNodes(n.content ?? [], key)}</blockquote>;
        case "codeBlock":
            return (
                <pre key={key} style={{ background: "#f5f5f5", padding: 10, borderRadius: 4, overflowX: "auto" }}>
                    <code>{renderNodes(n.content ?? [], key)}</code>
                </pre>
            );
        case "horizontalRule":
            return <hr key={key} />;
        case "image":
            return (
                <img
                    key={key}
                    src={mediaUrl(String(n.attrs?.src ?? ""))}
                    alt={String(n.attrs?.alt ?? "")}
                    loading="lazy"
                    style={{ maxWidth: "100%", height: "auto", borderRadius: 6, display: "block", margin: "8px 0" }}
                />
            );
        case "text":
            return applyMarks(n, key);
        case "hardBreak":
            return <br key={key} />;
        default:
            return null; // 未知节点：安全跳过
    }
}

function applyMarks(n: PMNode, key: string): ReactNode {
    let el: ReactNode = n.text ?? "";
    for (const m of n.marks ?? []) {
        if (m.type === "bold") el = <strong key={key}>{el}</strong>;
        else if (m.type === "italic") el = <em key={key}>{el}</em>;
        else if (m.type === "strike") el = <s key={key}>{el}</s>;
        else if (m.type === "code") el = <code key={key}>{el}</code>;
        else if (m.type === "link")
            el = (
                <a key={key} href={String(m.attrs?.href ?? "#")} target="_blank" rel="noopener noreferrer nofollow">
                    {el}
                </a>
            );
    }
    return el;
}
