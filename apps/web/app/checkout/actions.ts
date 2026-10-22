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
    // 会话与市场 id 互不依赖 → 并行取。这两个读**各自一个连接**（会话走 better-auth 自己的 client、
    // 市场走请求内 db），实测跨连接并行能重叠（~975ms → ~510ms，见 docs/PERF.md 探针⑧）；
    // 同一个 max:1 db 实例里 Promise.all 是无用的（探针⑥：1511 vs 1531ms），那种情形要的是合并成一条。
    // 这段延迟直接落在“用户按下 Place order”之后，是转化率最贵的那几百毫秒。
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
        // 不再包 db.transaction：createOrder 现在是**一条 data-modifying CTE**，单语句天然原子，
        // 而 BEGIN/COMMIT 在 max:1 的连接上是**两次额外的跨洋往返**。幂等仍由 createOrder 内部保证。
        const result = await createOrder(db, {
            idempotencyKey: crypto.randomUUID(),
            email,
            customerId,
            marketId: market.id,
            currency: "USD",
            locale: "en",
            shippingAddress: { recipient, phone, country, region, city, line1, line2, postalCode },
            items,
            shippingCents: SHIPPING_CENTS,
        });
        await writeCart({}); // 下单成功清空
        redirect(`/order/${result.orderNumber}`);
    } catch {
        // 不可售 / 库存不足 / 无价格 / 幂等重放 等 → 回结账提示
        redirect("/checkout?error=failed");
    }
}
