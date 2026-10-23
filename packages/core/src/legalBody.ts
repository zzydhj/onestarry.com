/**
 * 法律文档正文的极简解析。
 *
 * 为什么要有这个文件：`legal_documents.body` 存的是**纯文本**（见 packages/db/src/queries/legal.ts
 * 的注释「正文存纯文本，非 HTML」），前台原先一律渲染成 `<p>` —— 三千字的隐私政策没有小标题、
 * 没有列表，读起来是一整块砖。法律文本的可读性本身就是合规要求的一部分（用户得能看懂），
 * 所以这里加一层**约定极少**的块级结构，而不是引入 markdown 引擎或富文本 JSON：
 *
 *   · 空行分段（沿用原行为，老正文不受影响）
 *   · 行首 `## ` → 二级标题，`### ` → 三级标题
 *   · 一个块内**每行**都以 `- ` 开头 → 无序列表
 *
 * 刻意不支持：行内加粗/链接/表格/嵌套列表/代码。要那些说明该换 CMS 的 ProseMirror 正文，
 * 而不是把这里长成第二套 markdown。
 */

export type LegalBlock =
    | { kind: "h2"; text: string }
    | { kind: "h3"; text: string }
    | { kind: "p"; text: string }
    | { kind: "ul"; items: string[] };

/** 把纯文本正文切成块。空正文返回空数组（前台据此显示占位提示）。 */
export function parseLegalBlocks(body: string | null | undefined): LegalBlock[] {
    if (!body || !body.trim()) return [];
    const blocks: LegalBlock[] = [];
    for (const raw of body.split(/\n{2,}/)) {
        const chunk = raw.trim();
        if (!chunk) continue;

        if (chunk.startsWith("### ")) {
            blocks.push({ kind: "h3", text: chunk.slice(4).trim() });
            continue;
        }
        if (chunk.startsWith("## ")) {
            blocks.push({ kind: "h2", text: chunk.slice(3).trim() });
            continue;
        }

        const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
        // 整块都是 `- ` 才算列表：混排时（有人漏了一个短横）退化成普通段落，
        // 宁可少一层结构，也不要把半截句子吞进列表里。
        if (lines.length > 0 && lines.every((l) => l.startsWith("- "))) {
            blocks.push({ kind: "ul", items: lines.map((l) => l.slice(2).trim()) });
            continue;
        }
        blocks.push({ kind: "p", text: lines.join(" ") });
    }
    return blocks;
}
