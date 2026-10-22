"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@onestarry/ui";
import { markShippedAction } from "./actions";

/**
 * 标记发货（乐观 UI）。
 *
 * `recordShipment` 要在事务里改状态 + 写账本 + 扣库存 + 发事件，是后台最慢的写之一
 * （几趟跨洋往返），而且做完还要整页重渲染。旧写法点完"标记发货"要盯着空白等 2–4 秒。
 * 这里点下就立刻显示发货结果，同时后台提交；**action 返回失败就退回表单**——
 * 发货这种事不能让运营以为已经发了而实际没发。
 */
export function ShipForm({ orderId }: { orderId: string }) {
    const [carrier, setCarrier] = useState("");
    const [trackingNumber, setTracking] = useState("");
    const [done, setDone] = useState<{ carrier: string; tracking: string } | null>(null);
    const [failed, setFailed] = useState(false);
    const [pending, start] = useTransition();

    function submit() {
        const optimistic = { carrier: carrier.trim(), tracking: trackingNumber.trim() };
        setFailed(false);
        setDone(optimistic); // 立刻显示成已发货
        const form = new FormData();
        form.set("orderId", orderId);
        form.set("carrier", optimistic.carrier);
        form.set("trackingNumber", optimistic.tracking);
        start(async () => {
            const res = await markShippedAction(form);
            if (!res.ok) {
                setDone(null); // 回滚：未支付/已发货/账本不平
                setFailed(true);
            }
        });
    }

    if (done) {
        return (
            <div className="mt-2 rounded-xl border border-line bg-white p-3 text-sm">
                <div>
                    状态 <strong>shipped</strong> · 承运商 {done.carrier || "—"} · 运单号{" "}
                    <code className="font-mono text-xs">{done.tracking || "—"}</code>
                </div>
                <div className="mt-1 text-xs text-muted">{pending ? "同步中…" : "已记录（以本单刷新后的状态为准）"}</div>
            </div>
        );
    }

    return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="承运商（如 顺丰/4PX）"
                className="py-1.5 text-sm"
            />
            <Input
                value={trackingNumber}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="运单号"
                className="py-1.5 text-sm"
            />
            <Button type="button" onClick={submit} disabled={pending}>
                {pending ? "提交中…" : "标记发货"}
            </Button>
            {failed && <span className="text-xs text-red-600">发货失败：该单可能未支付/已发货，或账本不平。</span>}
        </div>
    );
}
