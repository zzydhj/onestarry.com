import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLegalBlocks } from "./legalBody";

/**
 * 法律文档正文解析的契约：老正文（只有段落）必须逐字不变地继续工作，
 * 新增的只有 `## ` / `### ` 标题与 `- ` 列表三种块。
 */

test("空正文一律切成空数组（前台据此显示“还没写”占位）", () => {
    assert.deepEqual(parseLegalBlocks(""), []);
    assert.deepEqual(parseLegalBlocks("   \n\n  "), []);
    assert.deepEqual(parseLegalBlocks(null), []);
    assert.deepEqual(parseLegalBlocks(undefined), []);
});

test("纯段落保持原行为：块内换行合成一个空格，块之间靠空行", () => {
    assert.deepEqual(parseLegalBlocks("第一行\n还是同一段\n\n第二段"), [
        { kind: "p", text: "第一行 还是同一段" },
        { kind: "p", text: "第二段" },
    ]);
});

test("`## ` 与 `### ` 是标题，且不会把标记本身漏进文字", () => {
    assert.deepEqual(parseLegalBlocks("## 1. Who we are\n\n### 我们的地址\n\n正文"), [
        { kind: "h2", text: "1. Who we are" },
        { kind: "h3", text: "我们的地址" },
        { kind: "p", text: "正文" },
    ]);
});

test("整块都是 `- ` 才当列表；只有一行也算列表", () => {
    assert.deepEqual(parseLegalBlocks("- 甲\n- 乙\n\n收尾"), [
        { kind: "ul", items: ["甲", "乙"] },
        { kind: "p", text: "收尾" },
    ]);
    assert.deepEqual(parseLegalBlocks("- 只有一条"), [{ kind: "ul", items: ["只有一条"] }]);
});

test("漏了一个短横 → 整块退化成段落，不吞句子（宁可少一层结构）", () => {
    assert.deepEqual(parseLegalBlocks("- 甲\n乙不是列表项"), [
        { kind: "p", text: "- 甲 乙不是列表项" },
    ]);
});
