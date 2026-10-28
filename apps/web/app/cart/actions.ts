"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clampCartQty } from "@onestarry/core";
import { readCart, writeCart } from "@/lib/cart";

/** 加入购物车（PDP 提交）→ 累加数量（封顶 CART_MAX_QTY，与读侧同源）→ 跳购物车。 */
export async function addToCartAction(formData: FormData): Promise<void> {
    const variantId = String(formData.get("variantId") ?? "");
    if (!variantId) return;
    // 至少加 1 件；累加后统一 clamp 到上限，否则 >999 会被读侧整条丢（审查 H-2）。
    const delta = Math.max(1, clampCartQty(Number(formData.get("qty")) || 1));
    const cart = await readCart();
    cart[variantId] = clampCartQty((cart[variantId] ?? 0) + delta);
    await writeCart(cart);
    redirect("/cart");
}

/** 设置某行数量（≤ 0 则移除；否则 clamp 到 1..上限）。 */
export async function setQtyAction(formData: FormData): Promise<void> {
    const variantId = String(formData.get("variantId") ?? "");
    if (!variantId) return;
    const qty = clampCartQty(Number(formData.get("qty")));
    const cart = await readCart();
    if (qty <= 0) delete cart[variantId];
    else cart[variantId] = qty;
    await writeCart(cart);
    revalidatePath("/cart");
}

/** 移除某行。 */
export async function removeItemAction(formData: FormData): Promise<void> {
    const variantId = String(formData.get("variantId") ?? "");
    if (!variantId) return;
    const cart = await readCart();
    delete cart[variantId];
    await writeCart(cart);
    revalidatePath("/cart");
}
