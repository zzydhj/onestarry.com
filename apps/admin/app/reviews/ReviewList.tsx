"use client";

import { useOptimistic, useTransition } from "react";
import { Button } from "@onestarry/ui";
import type { ReviewModerationRow, ReviewStatus } from "@onestarry/db";
import { moderateReviewAction } from "./actions";

const ACTIONS: { status: ReviewStatus; label: string; primary?: boolean }[] = [
    { status: "approved", label: "通过", primary: true },
    { status: "rejected", label: "拒绝" },
    { status: "flagged", label: "标记" },
];

/**
 * 评论审核列表（乐观 UI）。
 *
 * 为什么这块最值得做乐观：审核是**逐条连点**的流水线动作，一次后台停留要点十几下。
 * 旧写法每点一下都要等「写库 → 整页重渲染（会话+权限+列表 又是几趟跨洋往返）」才看见卡片消失，
 * 人会怀疑没点上而重复点。这里点下去就把该卡片从当前列表**立刻拿掉**，服务端确认后再对齐。
 *
 * 用 `useOptimistic` 而不是 useState：动作完成、服务端新 props 回来时覆盖层自动失效，
 * 不会出现"本地以为处理了、数据库其实没变"的长期错位（失败时下一次刷新就回到真状态）。
 */
export function ReviewList({ status, rows }: { status: ReviewStatus; rows: ReviewModerationRow[] }) {
    const [done, applyDone] = useOptimistic<Record<string, ReviewStatus>, { id: string; status: ReviewStatus }>(
        {},
        (state, next) => ({ ...state, [next.id]: next.status }),
    );
    const [pending, start] = useTransition();

    // 当前 tab 只看某个状态，所以"改成别的状态"= 从这一列消失；改成同一个状态则留在原地
    const visible = rows.filter((r) => !done[r.id] || done[r.id] === status);

    function act(id: string, target: ReviewStatus) {
        applyDone({ id, status: target });
        const form = new FormData();
        form.set("id", id);
        form.set("status", target);
        start(() => {
            void moderateReviewAction(form);
        });
    }

    if (visible.length === 0) {
        return (
            <div className="mt-5 space-y-3">
                <p className="text-sm text-muted">该状态下暂无评论。</p>
                {pending && <p className="text-xs text-muted">同步中…</p>}
            </div>
        );
    }

    return (
        <div className="mt-5 space-y-3">
            {visible.map((r) => {
                const acted = done[r.id];
                return (
                    <div key={r.id} className="rounded-xl border border-line bg-white p-4">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-brand">
                                {r.productTitle ?? "（未知商品）"} · {r.rating}★
                                {r.verifiedPurchase && <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs text-accent ring-1 ring-line">已购</span>}
                            </div>
                            <span className="text-xs text-muted">{r.createdAt.toISOString().slice(0, 10)}</span>
                        </div>
                        {r.title && <div className="mt-1 text-sm">{r.title}</div>}
                        {r.body && <div className="mt-1 text-sm text-muted">{r.body}</div>}
                        <div className="mt-3 flex items-center gap-2">
                            {ACTIONS.map((a) => (
                                <Button
                                    key={a.status}
                                    type="button"
                                    variant={a.primary ? "primary" : "secondary"}
                                    size="sm"
                                    onClick={() => act(r.id, a.status)}
                                    aria-pressed={acted === a.status}
                                >
                                    {a.label}
                                </Button>
                            ))}
                            {acted && <span className="text-xs text-muted">已记为 {acted}</span>}
                        </div>
                    </div>
                );
            })}
            {pending && <p className="text-xs text-muted">同步中…</p>}
        </div>
    );
}
