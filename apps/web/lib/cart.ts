import { cookies } from "next/headers";

/** 购物车 = { variantId: qty }，存 httpOnly cookie（无新表；结账时服务端按 DB 重新计价，防篡改）。 */
export type CartMap = Record<string, number>;

const KEY = "cart";

export async function readCart(): Promise<CartMap> {
    const raw = (await cookies()).get(KEY)?.value;
    if (!raw) return {};
    try {
        const o = JSON.parse(raw) as unknown;
        return o && typeof o === "object" ? (o as CartMap) : {};
    } catch {
        return {};
    }
}

export async function writeCart(map: CartMap): Promise<void> {
    (await cookies()).set(KEY, JSON.stringify(map), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
    });
}
