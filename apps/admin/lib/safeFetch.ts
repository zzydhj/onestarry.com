import { isSafeRemoteUrl, MAX_FETCH_BYTES, MAX_REDIRECTS } from "@onestarry/core";

/**
 * 带准入判断与字节上限的服务端 fetch（后台「贴链接导入」与拓图共用）。
 *
 * 两件事必须在这里做，而不是在每个调用点各做一遍：
 *
 * 1. **逐跳重判 URL**。`fetch(url, { redirect: "follow" })` 等于把最终目标交给远端决定 ——
 *    对方回一个 302 指向 `http://169.254.169.254/` 就绕过了入口的白名单。所以这里用
 *    `redirect: "manual"` 自己跟跳，每一跳都重新过 `isSafeRemoteUrl`。
 *
 * 2. **流式截断**。旧实现是 `await res.arrayBuffer()` 之后再判 `byteLength > 8MB`，
 *    那是**先把整个响应读进内存**再拒绝 —— 对端给 500MB 就先把我们的内存与 CPU 打满。
 *    现在边读边计，超限立刻 cancel。
 *
 * 超时也是这里给的：旧代码没有任何超时，一个慢速对端能把整个 Server Action 拖到 Worker 上限。
 */

const FETCH_TIMEOUT_MS = 15_000;

export async function safeFetch(raw: string): Promise<Response> {
    let next = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const decision = isSafeRemoteUrl(next);
        if (!decision.ok || !decision.url) throw new Error(`URL_NOT_ALLOWED:${decision.reason ?? "未知原因"}`);
        const res = await fetch(decision.url, {
            redirect: "manual",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { "user-agent": "Mozilla/5.0 (compatible; onestarry-import/1.0)" },
        });
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
            await res.body?.cancel().catch(() => {});
            next = new URL(loc, decision.url).toString(); // 相对 Location 也要能解析
            continue;
        }
        return res;
    }
    throw new Error(`TOO_MANY_REDIRECTS:>${MAX_REDIRECTS}`);
}

/** 读响应体，超过 maxBytes 立即取消并抛错（不先把整个体吃进内存）。 */
export async function readCapped(res: Response, maxBytes: number = MAX_FETCH_BYTES): Promise<Uint8Array> {
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`PAYLOAD_TOO_LARGE:${declared}>${maxBytes}`);
    }
    if (!res.body) return new Uint8Array(await res.arrayBuffer());

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`PAYLOAD_TOO_LARGE:${total}>${maxBytes}`);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
    }
    return out;
}

export async function readCappedText(res: Response, maxBytes: number = MAX_FETCH_BYTES): Promise<string> {
    return new TextDecoder().decode(await readCapped(res, maxBytes));
}
