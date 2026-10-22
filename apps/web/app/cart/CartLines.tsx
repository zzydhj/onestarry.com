"use client";

import { useOptimistic, useTransition } from "react";
import { Button, Input } from "@onestarry/ui";
import { removeItemAction, setQtyAction } from "./actions";

/** 购物车行（来自 getCartLines：单价/库存都以服务端为准，客户端只改数量）。 */
export interface CartLineView {
    variantId: string;
    sku: string;
    title: string;
    currency: string;
    unitCents: number;
    available: number;
    blocked: boolean;
}

type QtyMap = Record<string, number>;

function money(cents: number, cur: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(cents / 100);
}

/**
 * 购物车行编辑（乐观 UI）。
 *
 * 为什么必须乐观：改一个数量原本要等「写 cookie → 服务端整页重渲染（再查一次库）」才看见新数字，
 * 跨国那一趟往返约 0.5–1 秒，人在这段里什么都干不了，还会以为没点上而重复点。
 * `useOptimistic` 让数字**先按点击变**，等服务端新 props 回来再自动对齐 —— 覆盖层会自己消失，
 * 不会出现"本地状态和数据库越走越远"的经典坑（这也是不直接用 useState 的原因）。
 *
 * 取舍：删掉了 `<form action>` 的无 JS 兜底（数量编辑器本质是交互件，且加购按钮仍走原生表单）。
 */
export function CartLines({ lines, qty, shippingCents }: { lines: CartLineView[]; qty: QtyMap; shippingCents: number }) {
    const [pending, start] = useTransition();
    const [optQty, applyOptimistic] = useOptimistic(
        qty,
        (state: QtyMap, next: { variantId: string; value: number }) => ({ ...state, [next.variantId]: next.value }),
    );

    function commit(variantId: string, value: number) {
        applyOptimistic({ variantId, value });
        const form = new FormData();
        form.set("variantId", variantId);
        form.set("qty", String(value));
        // ≤0 走移除分支：服务端会删掉 cookie 里的这一项，重渲染后该行自然消失
        const action = value > 0 ? setQtyAction : removeItemAction;
        start(() => {
            void action(form);
        });
    }

    // 合计也按乐观数量算，否则用户改了数量、总额不动，比"慢"更让人不安
    let subtotal = 0;
    for (const l of lines) subtotal += l.unitCents * Math.max(0, optQty[l.variantId] ?? 0);
    const currency = lines[0]?.currency ?? "USD";
    const visible = lines.filter((l) => (optQty[l.variantId] ?? 0) > 0);

    return (
        <>
            <ul className="mt-6 divide-y divide-line">
                {visible.map((l) => {
                    const q = optQty[l.variantId] ?? 0;
                    return (
                        <li key={l.variantId} className="flex items-center justify-between gap-4 py-4">
                            <div className="min-w-0">
                                <div className="truncate font-medium">{l.title}</div>
                                <div className="font-mono text-xs text-muted">{l.sku}</div>
                                {l.blocked || l.available < q ? (
                                    <div className="text-xs text-red-600">{l.blocked ? "Not available" : `Only ${l.available} left`}</div>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    aria-label={`Quantity of ${l.title}`}
                                    type="number"
                                    min={0}
                                    defaultValue={q}
                                    onBlur={(e) => {
                                        const v = Number(e.currentTarget.value) || 0;
                                        if (v !== q) commit(l.variantId, v);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            const v = Number(e.currentTarget.value) || 0;
                                            if (v !== q) commit(l.variantId, v);
                                        }
                                    }}
                                    className="w-16 px-2 py-1"
                                />
                                <Button type="button" variant="secondary" size="sm" onClick={() => commit(l.variantId, 0)}>
                                    ✕
                                </Button>
                            </div>
                            <div className="w-24 text-right font-medium">{money(l.unitCents * q, l.currency)}</div>
                        </li>
                    );
                })}
            </ul>

            <div className="mt-6 space-y-1 text-right text-sm">
                <div>Subtotal {money(subtotal, currency)}</div>
                <div>Shipping {money(shippingCents, currency)}</div>
                <div className="pt-1 text-lg font-bold text-brand">Total {money(subtotal + shippingCents, currency)}</div>
            </div>
            {/* 提交中提示：不遮挡已变的数字，只说明"正在写入" */}
            {pending && <p className="mt-2 text-right text-xs text-muted">Saving…</p>}
        </>
    );
}
