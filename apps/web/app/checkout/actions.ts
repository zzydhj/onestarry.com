"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb, createOrder, markets } from "@onestarry/db";
import { PLACEHOLDER_SHIPPING_CENTS } from "@onestarry/core";
import { readCart, writeCart } from "@/lib/cart";
import { readCustomerSession } from "@/lib/session";

/**
 * 字段长度封顶 + 邮箱格式。旧实现只做了 `trim()`，而地址列都是 `text`（无长度上限），
 * 表单字段又不受 cookie 的 4KB 天然限制 —— 等于允许往库里写任意大的文本，
 * 并在后台订单详情页原样渲染（2026-10-23 审查 P2-14）。
 */
const clean = (v: FormDataEntryValue | null, max: number): string => String(v ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

    const email = clean(formData.get("email"), 254) || (session?.email ?? "");
    const recipient = clean(formData.get("recipient"), 120);
    const line1 = clean(formData.get("line1"), 250);
    const country = clean(formData.get("country"), 2).toUpperCase() || "US";
    const city = clean(formData.get("city"), 100) || undefined;
    const region = clean(formData.get("region"), 100) || undefined;
    const postalCode = clean(formData.get("postalCode"), 20) || undefined;
    const line2 = clean(formData.get("line2"), 250) || undefined;
    const phone = clean(formData.get("phone"), 40) || undefined;

    // 邮箱要能收信（发货/售后都靠它），国家要能进快照与运费判定：两者形状先校。
    if (!EMAIL_RE.test(email) || !recipient || !line1 || !/^[A-Z]{2}$/.test(country)) {
        redirect("/checkout?error=invalid");
    }

    const cart = await readCart();
    const items = Object.entries(cart).map(([variantId, quantity]) => ({ variantId, quantity }));
    if (items.length === 0) redirect("/cart");
    if (!market) redirect("/checkout?error=failed");

    // 幂等键由**表单带回来**（结账页渲染时生成）：旧实现每次提交现取一个 randomUUID，
    // 等于幂等键只是个形式——双击/重交照样建两张单。形状不合就现生成一个：
    // 宁可这一次不幂等，也不让任意字符串进 idempotency_keys。
    const submittedKey = clean(formData.get("idempotencyKey"), 64);
    const idempotencyKey = /^[0-9a-fA-F-]{16,64}$/.test(submittedKey) ? submittedKey : crypto.randomUUID();

    // 只把 createOrder 放进 try：Next 的 redirect() 靠抛 NEXT_REDIRECT 生效，若写在同一个 try 内
    // 会被下面的 catch 当“下单失败”吞掉 → 每笔成功单也被踢回 ?error=failed（审查 C-1，直接吃掉营收）。
    let result: Awaited<ReturnType<typeof createOrder>>;
    try {
        // createOrder 内部自管事务：建单（一条 data-modifying CTE）+ 原子占位（审查 H-2）必须同事务，
        // 占位不足才能把刚建的单/幂等键一起回滚。幂等与预留均由 createOrder 保证，调用方不再包 transaction。
        result = await createOrder(db, {
            idempotencyKey,
            email,
            customerId,
            marketId: market.id,
            // 不传币种（审查 L1）：createOrder 从价格行派生，前台/本处都不可能再“猜一个 USD”。
            locale: "en",
            shippingAddress: { recipient, phone, country, region, city, line1, line2, postalCode },
            items,
            shippingCents: PLACEHOLDER_SHIPPING_CENTS,
        });
    } catch (e) {
        // 给用户看的仍是人话提示（错误码里带 variantId，不该泄到前台），但原因必须进日志。
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[checkout] 下单失败：", msg);
        // createOrder 对不可售行抛 NOT_SELLABLE → 回专用码，结账页据此提示“移除不可售项”（审查 M-7）。
        if (msg.startsWith("NOT_SELLABLE")) redirect("/checkout?error=unavailable");
        redirect("/checkout?error=failed");
    }

    // 成功路径在 try 之外：清车失败绝不能挡住跳支付页（订单已入库），单独 catch 记日志即可。
    try {
        await writeCart({}); // 下单成功清空
    } catch (e) {
        console.error("[checkout] 下单成功但清空购物车失败：", e instanceof Error ? e.message : String(e));
    }
    // 先去支付页：钱没到之前不把用户丢到「订单已下」的庆功页（旧流程就是这么默认“已付”的）。
    // `t=` 是这张单的访问凭证，后面支付页与两个 API 路由都只认它。
    redirect(`/pay/${result.orderNumber}?t=${encodeURIComponent(result.publicToken)}`);
}
