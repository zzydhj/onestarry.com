/**
 * 可读订单号的生成（纯函数，无 IO，可单测）。
 *
 * 为什么要单独抽出来：旧实现是 `Math.floor(Math.random() * 46656)`（36³）—— 只有 **46,656 种**，
 * 而且 `Math.random()` 不是 CSPRNG。前台订单确认页在 2026-10-23 审查时是**无鉴权**的，
 * 两者复合起来就是"知道大概下单时间 → 几万发请求撞开别人的邮箱与购物内容"。
 * 现在随机段换成 `crypto.getRandomValues` 的 8 位 base36（≈41 bit），并把"时间前缀"保留下来
 * （运营肉眼排序、客服对单都需要它）。
 *
 * ⚠ 边界：单号只是**低价值标识**，不该当凭证用。真正的访客查单要靠签名 token（`order_lookup` 表，
 * 尚未建），见 docs/IMPLEMENTATION.md 的未接线清单。
 */

/** 随机段长度：8 位 base36 ≈ 41 bit 熵（旧值 3 位 ≈ 15.5 bit）。 */
export const ORDER_NUMBER_RANDOM_LEN = 8;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * 生成订单号：`SO-<时间 base36>-<8 位大写 base36>`。
 * `rng` 参数是为单测注入的（默认走 `crypto.getRandomValues`）；生产代码不要传。
 */
export function genOrderNumber(now: number = Date.now(), rng?: (n: number) => number): string {
    const stamp = now.toString(36).toUpperCase();
    const rand = randomBase36(ORDER_NUMBER_RANDOM_LEN, rng);
    return `SO-${stamp}-${rand}`;
}

/** 取 n 个均匀分布的 base36 字符。拒绝取模偏差：用 rejection sampling 丢掉 ≥ 252 的字节。 */
function randomBase36(n: number, rng?: (n: number) => number): string {
    let out = "";
    if (rng) {
        for (let i = 0; i < n; i++) out += ALPHABET[rng(36) % 36];
        return out;
    }
    // core 不开 DOM lib，故这里用结构类型描述“能拿到随机字节”的最小接口。
    type RandomSource = { getRandomValues?: (buf: Uint8Array) => Uint8Array };
    const c = (globalThis as { crypto?: RandomSource }).crypto;
    const g = c?.getRandomValues;
    if (typeof g !== "function") {
        throw new Error("crypto.getRandomValues 不可用：拒绝退化成 Math.random（那正是本次修掉的问题）");
    }
    const buf = new Uint8Array(n * 2); // 预留余量，rejection 后仍够填
    g.call(c, buf);
    for (const b of buf) {
        if (b >= 252) continue; // 252 = 36*7，超过会让尾部字符概率偏高
        out += ALPHABET[b % 36];
        if (out.length === n) break;
    }
    if (out.length < n) throw new Error("随机源不足，拒绝生成短订单号");
    return out;
}

/**
 * 单号形状（用于校验外部输入，别让任意字符串进查询）。
 *
 * 随机段接受 **3–8 位**：本次之前生成的是 3 位（线上实测 3 条存量单全部是 3 位后缀），
 * 收到 8 位会把它们全打成 404 —— 那是把安全修复做成业务回归。注意这只是**输入卫生**，
 * 不是鉴权：熵保证只对 `5a2d01d` 之后新生成的单成立，存量旧单的随机段仍是 3 位的小空间（已另掩码邮箱 + noindex 降低其价值）。
 */
const ORDER_NUMBER_RE = /^SO-[0-9A-Z]{1,10}-[0-9A-Z]{3,8}$/;

export function isOrderNumberShape(value: string): boolean {
    return ORDER_NUMBER_RE.test(value);
}

/**
 * 订单**访问凭证**（`public_token`）：与单号分开的 128 bit 随机串。
 *
 * 为什么单号不够：单号要给人读、给客服对，所以短（时间前缀 + 8 位 ≈ 41 bit）；
 * 而「游客能打开自己的单 / 能替自己的单发起支付」这件事需要一个**真凭证**。
 * 两者分开后：单号泄露不等于能改单，凭证泄露可以**轮换**（重生成即可，单号不变）。
 *
 * 不做恒定时间比较：128 bit 均匀随机 + 网络抖动下计时攻击不切实际；
 * 真要上强度应该做**尝试限速**（那属运行层职责，未接）而不是在这里加花活。
 */
export const ORDER_TOKEN_BYTES = 16; // 128 bit

/** base64url（无 `=` 补位），22 个字符，URL 安全。 */
export function genOrderAccessToken(rand?: Uint8Array): string {
    const bytes = rand ?? randomBytes(ORDER_TOKEN_BYTES);
    if (bytes.length < ORDER_TOKEN_BYTES) throw new Error("随机源不足，拒绝生成短凭证");
    return base64Url(bytes).slice(0, 22);
}

function randomBytes(n: number): Uint8Array {
    type RandomSource = { getRandomValues?: (buf: Uint8Array) => Uint8Array };
    const c = (globalThis as { crypto?: RandomSource }).crypto;
    if (typeof c?.getRandomValues !== "function") {
        throw new Error("crypto.getRandomValues 不可用：拒绝用弱随机数生成订单凭证");
    }
    const buf = new Uint8Array(n);
    c.getRandomValues(buf);
    return buf;
}

/** 自己实现 base64url（core 不开 DOM lib，btoa 在部分运行时也没有）。 */
function base64Url(bytes: Uint8Array): string {
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]!;
        const b1 = bytes[i + 1];
        const b2 = bytes[i + 2];
        out += B64[b0 >> 2];
        out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
        if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
        if (b2 !== undefined) out += B64[b2 & 63];
    }
    return out;
}

/** 凭证形状（URL 参数先过一道，不把任意字符串拿去比对）。 */
const ORDER_TOKEN_RE = /^[0-9A-Za-z_-]{20,24}$/;

export function isOrderAccessToken(value: string): boolean {
    return ORDER_TOKEN_RE.test(value);
}
