import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedImageType, jsonLdScript, safeHref } from "./safeOutput";

/** 三条输出净化的契约，每条对应 2026-10-23 审查里一个可达的存储型 XSS。 */

test("jsonLdScript：标题里塞 script 结束标签跳不出去，但 JSON 仍能原样解析回来", () => {
    const evil = { name: "</script><img src=x onerror=alert(1)>", price: "9.90" };
    const out = jsonLdScript(evil);
    assert.ok(!out.includes("</scr" + "ipt"), "不能出现可跳出 script 上下文的字面量");
    assert.ok(!out.includes("<img"), "不能出现裸尖括号");
    assert.deepEqual(JSON.parse(out), evil, "转义必须是可逆的，否则 SEO 数据就废了");
});

test("jsonLdScript：与 U+2028 也处理（内联脚本的两个语法陷阱）", () => {
    const src = { t: "a&b" + String.fromCharCode(0x2028) + "c" };
    const out = jsonLdScript(src);
    assert.ok(!out.includes("&"), "裸 & 必须转义");
    assert.ok(!out.includes(String.fromCharCode(0x2028)), "裸 U+2028 会让内联脚本报语法错");
    assert.deepEqual(JSON.parse(out), src);
});

test("safeHref：javascript: / data: / 带控制字符的绕过 全降级成井号", () => {
    assert.equal(safeHref("javascript:alert(1)"), "#");
    assert.equal(safeHref("JaVaScRiPt:alert(1)"), "#");
    assert.equal(safeHref("java\u0009script:alert(1)"), "#", "制表符绕过");
    assert.equal(safeHref("data:text/html,x"), "#");
    assert.equal(safeHref("vbscript:msgbox(1)"), "#");
    assert.equal(safeHref("//evil.example/x"), "#", "协议相对写法");
});

test("safeHref：正常链接不误伤", () => {
    assert.equal(safeHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
    assert.equal(safeHref("http://example.com"), "http://example.com");
    assert.equal(safeHref("/products/ceramic-mug"), "/products/ceramic-mug");
    assert.equal(safeHref("#section"), "#section");
    assert.equal(safeHref("mailto:hi@example.com"), "mailto:hi@example.com");
    assert.equal(safeHref(null), "#");
    assert.equal(safeHref("   "), "#");
});

test("acceptedImageType：SVG 明确拒绝（它是可执行容器），白名单内给归一化类型", () => {
    assert.equal(acceptedImageType("image/svg+xml"), null);
    assert.equal(acceptedImageType("application/json"), null);
    assert.equal(acceptedImageType(""), null);
    assert.equal(acceptedImageType(null), null);
    assert.deepEqual(acceptedImageType("image/png"), { contentType: "image/png", ext: "png" });
    assert.deepEqual(acceptedImageType("image/jpeg; charset=binary"), { contentType: "image/jpeg", ext: "jpg" });
    assert.deepEqual(acceptedImageType("image/jpg"), { contentType: "image/jpeg", ext: "jpg" }, "归一化别名");
});
