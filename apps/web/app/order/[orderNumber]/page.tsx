import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveOrderAccess } from "@/lib/orderAccess";

export const dynamic = "force-dynamic";

/**
 * 订单确认页。三件事是硬要求（2026-10-23 审查 P0-1 与随后的实测）：
 *   ① 不能被搜索引擎收录 —— 旧版连 `metadata` 都没导出，于是继承根布局的 `index: true`；
 *   ② 归属判定不能在这一页里另写一套 —— 统一走 `lib/orderAccess`（会话或 `?t=` 凭证）；
 *   ③ **不配 loading.tsx** —— `force-dynamic` + 骨架文件会把 `notFound()` 变成「404 页面 + HTTP 200」的软响应。
 *
 * 无凭证时仍可看（客服/收藏链接场景），但**邮箱掩码**；拿到凭证或本人登录才显示明文与去支付入口。
 */
export const metadata: Metadata = {
    title: "Order confirmation",
    robots: { index: false, follow: false },
};

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** j.doe@example.com → j***@example.com（够人对上自己那单，不足以转卖别人身份）。 */
function maskEmail(email: string | null): string {
    if (!email) return "—";
    const at = email.indexOf("@");
    if (at <= 0) return "***";
    return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export default async function OrderPage({
    params,
    searchParams,
}: {
    params: Promise<{ orderNumber: string }>;
    searchParams: Promise<{ t?: string }>;
}) {
    const { orderNumber } = await params;
    const { t: token } = await searchParams;

    // 审查 L-2：Next 已对路由段做过 percent 解码，这里再 `decodeURIComponent` 一是多余、
    // 二是对非法 % 序列（如已解码成 "SO-%zz"）抛 URIError → 500。`resolveOrderAccess` 内部已用
    // `^[A-Za-z0-9_-]+$` 校验，含任何 % 直接判为本不存→ null → 404。
    const access = await resolveOrderAccess(orderNumber, token);
    if (!access.ok) notFound();
    const { order, items, canSeeFull, payable } = access;

    return (
        <div className="mx-auto max-w-lg px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">Order placed 🎉</h1>
            <p className="mt-2 text-muted">
                Order number: <strong className="text-fg">{order.orderNumber}</strong>
            </p>
            <p className="mt-1 text-sm text-muted">
                Status: {order.status} · Payment: {order.paymentStatus} ·{" "}
                {canSeeFull ? order.email : maskEmail(order.email)}
            </p>
            {!canSeeFull && (
                <p className="mt-1 text-xs text-muted">Sign in or open your payment link to see the full email.</p>
            )}

            {payable && (
                <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    This order is not paid yet.{" "}
                    {canSeeFull ? (
                        <Link href={`/pay/${order.orderNumber}${token ? `?t=${encodeURIComponent(token)}` : ""}`} className="font-medium underline">
                            Continue to payment →
                        </Link>
                    ) : (
                        <span>Open the payment link we gave you after checkout.</span>
                    )}
                </p>
            )}

            <ul className="mt-6 divide-y divide-line">
                {items.map((it) => (
                    <li key={it.id} className="flex justify-between py-2 text-sm">
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
                <span>Total</span>
                <span>{money(order.totalCents, order.currency)}</span>
            </div>

            <p className="mt-8">
                <Link href="/" className="text-sm text-muted transition hover:text-accent">
                    ← All products
                </Link>
            </p>
        </div>
    );
}
