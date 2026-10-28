/**
 * 购物车 cookie 的净化（纯函数，可单测）。
 *
 * 为什么必须有：`cart` 虽然是 httpOnly，**但 httpOnly 只挡脚本，不挡用户在 DevTools 里手改值**。
 * 2026-10-23 审查时的链路是「JSON.parse 后原样返回 → 直接参与金额乘法」，于是
 * `{"<uuid>": -3}` 能把订单算成负数、`{"<uuid>": 1e15}` 能造出一千亿美元的订单，
 * 而数据库当时**一条 CHECK 约束都没有**，写进去就是既成事实。
 *
 * 所以这里定下唯一口径：**数量必须是 1..CART_MAX_QTY 的整数，变体 id 必须是 UUID 形状**，
 * 非法条目一律丢掉并把条数带回去（要能记日志，不能静默 —— 静默会让"为什么少了一件"查不出来）。
 */

/** 单张购物车最多多少行（防有人塞 10 万个 key 把结账 SQL 撑爆）。 */
export const CART_MAX_LINES = 50;
/** 单行最多几件。真实批发走 B2B 通道，不该由 cookie 决定。 */
export const CART_MAX_QTY = 999;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CartItem {
    variantId: string;
    quantity: number;
}

export interface CartSanitizeResult {
    /** 合法条目，保持原顺序。 */
    items: CartItem[];
    /** 被丢弃的条目数（0 = cookie 本来就干净）。 */
    dropped: number;
}

export function sanitizeCartMap(raw: unknown): CartSanitizeResult {
    const items: CartItem[] = [];
    let dropped = 0;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        // 整个 cookie 就不是对象：算一条被丢的，让上层至少知道"有东西被拒了"。
        return { items, dropped: raw === undefined || raw === null ? 0 : 1 };
    }
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (items.length >= CART_MAX_LINES) {
            dropped++;
            continue;
        }
        if (!UUID_RE.test(key)) {
            dropped++;
            continue;
        }
        // 只接受真正的整数：数字字符串、小数、NaN、Infinity、负数、0 全拒。
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > CART_MAX_QTY) {
            dropped++;
            continue;
        }
        items.push({ variantId: key, quantity: value });
    }
    return { items, dropped };
}

/** 从 cookie 原文一步到位：解析失败也给空清单，不抛错（前台读车不能因为一个坏 cookie 白屏）。 */
export function parseCartCookie(value: string | null | undefined): CartSanitizeResult {
    if (!value) return { items: [], dropped: 0 };
    try {
        return sanitizeCartMap(JSON.parse(value));
    } catch {
        return { items: [], dropped: 1 };
    }
}

/**
 * 写侧数量归一（审查 H-2）：把任意输入折成 `0..CART_MAX_QTY` 的整数。
 * 旧写侧不做任何归一（`addToCart` 不封顶、`setQty` 连小数/Infinity 都不处理），
 * 而读侧 `sanitizeCartMap` 会把 `>999 / 小数 / 非整数` 整条**丢弃**——于是输入 1000
 * 或多轮加购累加到 1010 → 下次渲染该商品整行静默消失。两侧必须同源：写侧先 clamp，
 * 永不会写出一个读侧会丢的值。返回 0 由调用方当作「移除」处理。
 */
export function clampCartQty(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.min(CART_MAX_QTY, Math.max(0, Math.floor(n)));
}
