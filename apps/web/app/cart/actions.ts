"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { readCart, writeCart } from "@/lib/cart";

/** 加入购物车（PDP 提交）→ 累加数量 → 跳购物车。 */
export async function addToCartAction(formData: FormData): Promise<void> {
    const variantId = String(formData.get("variantId") ?? "");
    const qty = Math.max(1, Number(formData.get("qty") ?? 1) || 1);
    if (!variantId) return;
    const cart = await readCart();
    cart[variantId] = (cart[variantId] ?? 0) + qty;
    await writeCart(cart);
    redirect("/cart");
}

/** 设置某行数量（≤0 则移除）。 */
export async function setQtyAction(formData: FormData): Promise<void> {
    const variantId = String(formData.get("variantId") ?? "");
    const qty = Number(formData.get("qty") ?? 0) || 0;
    if (!variantId) return;
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
