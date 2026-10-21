"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, createOrder, markets } from "@onestarry/db";
import { readCart, writeCart } from "@/lib/cart";
import { readCustomerSession } from "@/lib/session";

const SHIPPING_CENTS = 500; // MVP 占位运费（真实 computeShipping 待接）

/** 结账：读购物车 → 多商品 createOrder（真实地址）→ 清空购物车 → 跳确认页。 */
export async function checkoutAction(formData: FormData): Promise<void> {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    // 会话与市场 id 互不依赖 → 并行取。旧写法是“先等会话、再等市场”串行两个跨区往返，
    // 而这一段延迟直接落在“用户按下 Place order”之后，是转化率最贵的那几百毫秒。
    const [session, marketRow] = await Promise.all([
        readCustomerSession(),
        db.select({ id: markets.id }).from(markets).where(eq(markets.code, "us")).limit(1),
    ]);
    const market = marketRow[0];
    const customerId = session?.userId ?? null;

    const email = String(formData.get("email") ?? "").trim() || (session?.email ?? "");
    const recipient = String(formData.get("recipient") ?? "").trim();
    const line1 = String(formData.get("line1") ?? "").trim();
    const country = String(formData.get("country") ?? "").trim() || "US";
    const city = String(formData.get("city") ?? "").trim() || undefined;
    const region = String(formData.get("region") ?? "").trim() || undefined;
    const postalCode = String(formData.get("postalCode") ?? "").trim() || undefined;
    const line2 = String(formData.get("line2") ?? "").trim() || undefined;
    const phone = String(formData.get("phone") ?? "").trim() || undefined;

    if (!email || !recipient || !line1) redirect("/checkout?error=invalid");

    const cart = await readCart();
    const items = Object.entries(cart).map(([variantId, quantity]) => ({ variantId, quantity }));
    if (items.length === 0) redirect("/cart");
    if (!market) redirect("/checkout?error=failed");

    try {
        const result = await db.transaction((tx) =>
            createOrder(tx, {
                idempotencyKey: crypto.randomUUID(),
                email,
                customerId,
                marketId: market.id,
                currency: "USD",
                locale: "en",
                shippingAddress: { recipient, phone, country, region, city, line1, line2, postalCode },
                items,
                shippingCents: SHIPPING_CENTS,
            }),
        );
        await writeCart({}); // 下单成功清空
        redirect(`/order/${result.orderNumber}`);
    } catch {
        // 不可售 / 库存不足 / 无价格 等 → 回结账提示
        redirect("/checkout?error=failed");
    }
}
