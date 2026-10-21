"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

/**
 * 提交中的按钮：自动禁用 + 转圈。
 *
 * 为什么单独成文件：`useFormStatus` 只能在客户端组件里调用，而 `Button` 必须保持
 * 服务端安全（它的 `buttonVariants()` 会被服务端组件直接调用生成 <Link> 样式）。
 * 所以这里只做"提交态"这一件事，由 `Button` 在 type="submit" 时内部换用。
 *
 * 价值：后台一次写操作要等 1–3 秒，没有反馈时人会重复点 —— 重复提交对
 * 「标记发货 / 新增商品 / 改价」这类动作是真风险，不只是体感问题。
 */
export function SubmitButton({ children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
    const { pending } = useFormStatus();
    return (
        <button type="submit" aria-busy={pending || undefined} disabled={disabled || pending} {...props}>
            {pending ? (
                <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
            ) : null}
            {children}
        </button>
    );
}
