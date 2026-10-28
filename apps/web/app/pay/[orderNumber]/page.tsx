import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { paypalSdkUrls } from "@onestarry/core";
import { PayPalPayButton } from "@/components/PayPalPayButton";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { readPaypalConfig } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * 支付页：订单摘要 + PayPal 按钮。结账成功后落在这里，钱**不经过**我们的服务器持有卡号。
 *
 * ⚠ 与确认页同一条规矩：**不要给本路由加 loading.tsx**。`force-dynamic` 页面一旦有骨架文件，
 *   Next 会先把流式外壳冲出去（状态行当场定成 200），之后的 `notFound()` / `redirect()` 只能往
 *   Suspense 边界里塞内容 → 变成「404 页面 + HTTP 200」的软响应（2026-10-23 线上实测踩过）。
 *
 * 归属：只认 `?t=<凭证>` 或登录会话（判定集中在 `lib/orderAccess`）。没凭证的人看到的是
 * 「请去邮箱/账户里找链接」的引导页，**不确认这张单是否存在**。
 */
export const metadata: Metadata = {
    title: "Payment",
    robots: { index: false, follow: false },
};

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function PayPage({
    params,
    searchParams,
}: {
    params: Promise<{ orderNumber: string }>;
    searchParams: Promise<{ t?: string; canceled?: string }>;
}) {
    const { orderNumber } = await params;
    const { t: token, canceled } = await searchParams;

    // 审查 L-2：同 order 页——路由段已由 Next 解码，再 `decodeURIComponent` 对非法 % 序列抛 URIError→500；
    // `resolveOrderAccess` 内部已正则校验，直接传 orderNumber。
    const access = await resolveOrderAccess(orderNumber, token);
    if (!access.ok) notFound();
    if (!access.canSeeFull) {
        return (
            <div className="mx-auto max-w-lg px-4 py-8">
                <h1 className="text-2xl font-semibold tracking-tight">Payment link needed</h1>
                <p className="mt-2 text-sm text-muted">
                    This page needs the payment link from your order confirmation.{" "}
                    <Link href="/account/orders" className="text-accent hover:underline">
                        Sign in
                    </Link>{" "}
                    to see your orders.
                </p>
            </div>
        );
    }

    const { order, items } = access;
    // 按钮/回调需要的凭证：正常结账链路从 `?t=` 带；登录本人从「我的订单」进来时 URL 无 `?t=`，
    // 但已能过 canSeeFull（会话归属）—— 此时用订单自身的 publicToken 兜底（publicToken 非空、且已过闸，
    // 不是新泄露）。否则渲染条件会比服务端(/api/paypal/orders 认会话或凭证)更严 → 本人从订单列表点「去支付」变死路（审查 M3）。
    const payToken = token ?? order.publicToken;
    const href = `/order/${order.orderNumber}${payToken ? `?t=${encodeURIComponent(payToken)}` : ""}`;

    // 已付或已取消：没什么可付的，直接去确认页（重复点链接也只会看到这一条路）。
    if (!access.payable) redirect(href);

    const { env } = getCloudflareContext();
    const cfg = readPaypalConfig(env);
    let sdkUrls: string[] = [];
    if (cfg) {
        try {
            // 两个候选 host（主选 + 备选）：按钮出不来时不至于先怀疑凭据。见 core/paypal 的 paypalSdkUrls。
            sdkUrls = paypalSdkUrls({ clientId: cfg.clientId, currency: order.currency, env: cfg.env });
        } catch (e) {
            // client-id 填错（带了引号/空格/误填 secret）：页面上说清楚，别让人对着空白按钮猜。
            console.error("[paypal] SDK URL 构造失败：", e instanceof Error ? e.message : e);
        }
    }

    return (
        <div className="mx-auto max-w-lg px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">Complete your payment</h1>
            <p className="mt-2 text-sm text-muted">
                Order <strong className="text-fg">{order.orderNumber}</strong>
            </p>
            {canceled === "1" && <p className="mt-2 text-sm text-amber-600">Payment was canceled. You can try again.</p>}

            <ul className="mt-6 divide-y divide-line text-sm">
                {items.map((it) => (
                    <li key={it.id} className="flex justify-between py-2">
                        <span>
                            {it.title ?? "Item"} × {it.quantity}
                        </span>
                        <span>{money(it.unitPriceCents * it.quantity, order.currency)}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-2 space-y-1 text-right text-sm text-muted">
                {order.discountCents > 0 && <div>Discount -{money(order.discountCents, order.currency)}</div>}
                <div>Shipping {money(order.shippingCents, order.currency)}</div>
                {order.taxCents > 0 && <div>Tax {money(order.taxCents, order.currency)}</div>}
                {order.dutyCents > 0 && <div>Duty {money(order.dutyCents, order.currency)}</div>}
            </div>
            <div className="mt-2 flex justify-between text-lg font-bold text-brand">
                <span>Total due</span>
                <span>{money(order.totalCents, order.currency)}</span>
            </div>

            <div className="mt-8">
                {sdkUrls.length > 0 && payToken ? (
                    <PayPalPayButton orderNumber={order.orderNumber} token={payToken} sdkUrls={sdkUrls} successHref={href} />
                ) : (
                    <div className="rounded-md border border-line bg-surface p-4">
                        <p className="text-sm font-medium">PayPal is not available yet</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                            {!cfg && <li>Set the worker variables PAYPAL_CLIENT_ID, PAYPAL_SECRET and PAYPAL_ENV (see docs/IMPLEMENTATION.md).</li>}
                            {cfg && sdkUrls.length === 0 && <li>PAYPAL_CLIENT_ID looks malformed — check for quotes or stray spaces.</li>}
                        </ul>
                    </div>
                )}
            </div>

            <p className="mt-8">
                <Link href="/cart" className="text-sm text-muted transition hover:text-accent">
                    ← Back to cart
                </Link>
            </p>
        </div>
    );
}
