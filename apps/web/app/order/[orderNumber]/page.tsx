import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isOrderNumberShape } from "@onestarry/core";
import { createDb, getOrderByNumber } from "@onestarry/db";
import { readCustomerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 这页含**客户邮箱与购物内容**，所以两件事是硬要求（2026-10-23 审查 P0-1）：
 *   ① 绝不能被搜索引擎收录 —— 旧版连 `metadata` 都没导出，于是继承根布局的 `index: true`，
 *      而 robots.txt 的 disallow 列表里也没有 `/order`（同类的 account/cart/checkout 都各自设了）。
 *   ② 单号不能当密码用 —— 随机段已从 3 位（36³=46,656，且用 Math.random）换成 CSPRNG 8 位。
 * 归属可判时（登录客户）严格判归属；游客单只能靠"知道单号"这个能力凭证访问，
 * 因此对非归属查看者**掩码邮箱**：确认页要给人看的是"我们收到你的单了"，不是把 PII 广播出去。
 *
 * ⚠ 本路由**故意不配 loading.tsx**（2026-10-23 线上实测）：`force-dynamic` 页面一旦有 loading.tsx，
 *   Next 会先把**流式外壳**冲出去（状态行当场定成 200），之后 `notFound()` 只能往 Suspense 边界里
 *   塞 404 内容 —— 结果就是「404 页面 + HTTP 200」的软 404。确认页只有一次查库，骨架省不了什么时间，
 *   但状态码语义不能错（客服/爬虫/监控都看它）。ISR 页面（PDP/分类页）不受此影响：整页渲完才写进缓存，404 保得住。
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

export default async function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
    const { orderNumber } = await params;
    const raw = decodeURIComponent(orderNumber);
    // 形状不符直接 404：省一次跨洋查库，也不给枚举者"这号存在吗"的额外信号面。
    if (!isOrderNumberShape(raw)) notFound();

    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const session = await readCustomerSession();

    const res = await getOrderByNumber(db, raw);
    if (!res) notFound();
    const { order, items } = res;

    // 登录客户不得读到别人的单（连"存在与否"都不确认，所以走 notFound 而不是 403）。
    if (session?.userId && order.customerId && order.customerId !== session.userId) notFound();
    const isOwner = !!session?.userId && order.customerId === session.userId;

    return (
        <div className="mx-auto max-w-lg px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight">Order placed 🎉</h1>
            <p className="mt-2 text-muted">Order number: <strong className="text-fg">{order.orderNumber}</strong></p>
            <p className="mt-1 text-sm text-muted">
                Status: {order.status} · Payment: {order.paymentStatus} · {isOwner ? order.email : maskEmail(order.email)}
            </p>
            {!isOwner && (
                <p className="mt-1 text-xs text-muted">
                    Sign in to see the full email for this order.
                </p>
            )}

            <ul className="mt-6 divide-y divide-line">
                {items.map((it) => (
                    <li key={it.id} className="flex justify-between py-2 text-sm">
                        <span>{it.title ?? "Item"} × {it.quantity}</span>
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
                <Link href="/" className="text-sm text-muted transition hover:text-accent">← All products</Link>
            </p>
        </div>
    );
}
