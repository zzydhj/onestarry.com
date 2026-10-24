"use client";

import { useEffect, useRef, useState } from "react";

/**
 * PayPal 按钮（JS SDK）。
 *
 * 只干三件事：加载 SDK → 把「建单/扣款」两件事交给**我们自己的**路由 → 成功后跳确认页。
 * 刻意不碰金额：金额由服务端从库里取（见 /api/paypal/orders），这里递什么都会被忽略。
 *
 * SDK 用一个 20 行的 loader 而不是 `@paypal/paypal-js`：多一个依赖换来的是同样的
 * `document.createElement("script")`，而模板少一个依赖就少一次升级面。
 */
interface PaypalGlobal {
    Buttons: (opts: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void> };
}

declare global {
    interface Window {
        paypal?: PaypalGlobal;
    }
}

export interface PayPalPayButtonProps {
    orderNumber: string;
    /** 结账链路发下来的访问凭证；两个路由都要它，缺了就 403。 */
    token: string;
    sdkUrl: string;
    /** 支付成功后的落地页（服务端拼好，避免前端拼 URL 拼出歧义）。 */
    successHref: string;
}

function loadSdk(url: string): Promise<PaypalGlobal> {
    return new Promise((resolve, reject) => {
        if (window.paypal) return resolve(window.paypal);
        const done = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PAYPAL_SDK_MISSING")));
        const existing = document.querySelector<HTMLScriptElement>("script[data-onestarry-paypal]");
        if (existing) {
            existing.addEventListener("load", done, { once: true });
            existing.addEventListener("error", () => reject(new Error("PAYPAL_SDK_LOAD_FAILED")), { once: true });
            return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.setAttribute("data-onestarry-paypal", "1");
        script.addEventListener("load", done, { once: true });
        script.addEventListener("error", () => reject(new Error("PAYPAL_SDK_LOAD_FAILED")), { once: true });
        document.body.appendChild(script);
    });
}

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
}

export function PayPalPayButton({ orderNumber, token, sdkUrl, successHref }: PayPalPayButtonProps) {
    const holder = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const el = holder.current;
        if (!el) return;
        let alive = true;
        setError(null);
        el.replaceChildren(); // StrictMode 下 effect 会跑两遍，不清空会渲染出两个按钮

        loadSdk(sdkUrl)
            .then((paypal) => {
                if (!alive) return;
                return paypal
                    .Buttons({
                        createOrder: async () => {
                            setBusy(true);
                            const { ok, data } = await postJson("/api/paypal/orders", { orderNumber, token });
                            if (!ok || typeof data.orderID !== "string") {
                                throw new Error(typeof data.error === "string" ? data.error : "CREATE_FAILED");
                            }
                            return data.orderID;
                        },
                        onApprove: async (data: { orderID: string }) => {
                            const { ok, data: result } = await postJson("/api/paypal/capture", { orderNumber, token, orderID: data.orderID });
                            if (!ok) throw new Error(typeof result.error === "string" ? result.error : "CAPTURE_FAILED");
                            window.location.assign(successHref);
                        },
                        onCancel: () => {
                            setBusy(false);
                            setError("PAYMENT_CANCELED");
                        },
                        onError: (e: unknown) => {
                            setBusy(false);
                            setError(e instanceof Error ? e.message : "PAYPAL_ERROR");
                        },
                    })
                    .render(el);
            })
            .catch((e: unknown) => {
                if (!alive) return;
                setError(e instanceof Error ? e.message : "PAYPAL_SDK_LOAD_FAILED");
            });

        return () => {
            alive = false;
        };
    }, [orderNumber, token, sdkUrl, successHref]);

    return (
        <div>
            {error && (
                <p className="mb-2 text-sm text-red-600">
                    {error === "PAYMENT_CANCELED" ? "Payment canceled — you can try again." : "PayPal error:"}{" "}
                    {error !== "PAYMENT_CANCELED" && <code className="text-xs">{error}</code>}
                </p>
            )}
            <div ref={holder} aria-busy={busy} />
            <noscript>
                <p className="mt-2 text-sm text-muted">Enabling JavaScript is required to pay with PayPal.</p>
            </noscript>
        </div>
    );
}
