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

/** 单号形状（用于校验外部输入，别让任意字符串进查询）。 */
const ORDER_NUMBER_RE = /^SO-[0-9A-Z]{1,10}-[0-9A-Z]{8}$/;

export function isOrderNumberShape(value: string): boolean {
    return ORDER_NUMBER_RE.test(value);
}
