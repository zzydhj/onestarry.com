import { cookies } from "next/headers";
import { parseCartCookie } from "@onestarry/core";

/** 购物车 = { variantId: qty }，存 httpOnly cookie（无新表；结账时服务端按 DB 重新计价，防篡改）。 */
export type CartMap = Record<string, number>;

const KEY = "cart";

/**
 * 读车。**旧实现是 `JSON.parse` 后原样返回** —— 而 httpOnly 只挡脚本、不挡用户在 DevTools
 * 里手改 cookie 值，于是 `{"<uuid>": -3}` 能把订单算成负数。净化口径单一真源在
 * `@onestarry/core/cartMap`（带单测）：数量必须是 1..999 的整数、key 必须是 UUID 形状。
 * 被丢弃的条数要记日志：静默少一件商品比报错更难查。
 */
export async function readCart(): Promise<CartMap> {
    const raw = (await cookies()).get(KEY)?.value;
    const { items, dropped } = parseCartCookie(raw);
    if (dropped > 0) console.warn(`[cart] 丢弃 ${dropped} 条非法购物车条目`);
    return Object.fromEntries(items.map((i) => [i.variantId, i.quantity]));
}

export async function writeCart(map: CartMap): Promise<void> {
    (await cookies()).set(KEY, JSON.stringify(map), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
    });
}
