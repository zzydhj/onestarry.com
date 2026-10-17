"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, createOrder, markets } from "@onestarry/db";

/**
 * MVP-0 下单：PDP 表单提交 → 真实 createOrder（写订单 + 发 outbox 事件）→ 跳确认页。
 * 演示用占位地址；真实结账（地址表单/运费/税/支付）在步骤 11/12 完善。
 */
export async function placeOrder(formData: FormData): Promise<void> {
    const variantId = String(formData.get("variantId") ?? "");
    const email = String(formData.get("email") ?? "").trim() || "guest@example.com";
    const qty = Math.max(1, Number(formData.get("qty") ?? 1) || 1);

    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);

    const market = (await db.select({ id: markets.id }).from(markets).where(eq(markets.code, "us")).limit(1))[0];
    if (!market) throw new Error("MARKET_NOT_FOUND");

    const result = await db.transaction((tx) =>
        createOrder(tx, {
            idempotencyKey: crypto.randomUUID(),
            email,
            marketId: market.id,
            currency: "USD",
            locale: "en",
            shippingAddress: { recipient: email, line1: "Demo order (address TBD at real checkout)", country: "US" },
            items: [{ variantId, quantity: qty }],
            shippingCents: 500,
        }),
    );

    redirect(`/order/${result.orderNumber}`);
}
