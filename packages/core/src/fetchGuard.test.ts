import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FETCH_BYTES, MAX_REDIRECTS, isSafeRemoteUrl } from "./fetchGuard";

/** 服务端代抓外部 URL 的准入判断（后台「贴链接导入」与拓图共用）。 */

function ok(url: string) {
    const d = isSafeRemoteUrl(url);
    assert.equal(d.reason, undefined, `应放行：${url}`);
    assert.equal(d.ok, true, `应放行：${url}`);
}
function no(url: string) {
    assert.equal(isSafeRemoteUrl(url).ok, false, `应拒绝：${url}`);
}

test("放行正常公网商品页", () => {
    ok("https://shop.example.com/products/mug");
    ok("http://example.com");
    ok("https://example.com:443/a");
});

test("拒绝非 http(s) 协议与垃圾输入", () => {
    no("file:///etc/passwd");
    no("ftp://example.com/x");
    no("javascript:alert(1)");
    no("not a url");
    no("");
});

test("拒绝环回、私网、链路本地与云元数据字面量", () => {
    no("http://localhost:3000/");
    no("http://127.0.0.1/");
    no("http://0.0.0.0/");
    no("http://10.1.2.3/");
    no("http://172.16.0.1/");
    no("http://192.168.1.1:8080/");
    no("http://169.254.169.254/latest/meta-data/");
    no("http://100.100.100.200/");
    no("http://[::1]/");
    no("http://[fd00::12]/");
});

test("拒绝内部域名与无点主机名", () => {
    no("http://metadata.google.internal/");
    no("http://myhost.local/");
    no("http://intranet/");
});

test("拒绝带凭据的 URL 与非标准端口", () => {
    no("https://user:pass@example.com/");
    no("http://example.com:8080/");
    no("http://example.com:22/");
});

test("上限常量存在且合理（调用方必须流式截断、限重定向次数）", () => {
    assert.equal(MAX_FETCH_BYTES, 8 * 1024 * 1024);
    assert.ok(MAX_REDIRECTS >= 1 && MAX_REDIRECTS <= 5);
});
