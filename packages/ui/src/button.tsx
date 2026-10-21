import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { SubmitButton } from "./submit-button";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
    "inline-flex items-center justify-center gap-1 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

const VARIANTS: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white hover:opacity-90",
    secondary: "border border-line text-fg hover:bg-surface",
    ghost: "text-muted hover:text-accent",
    danger: "border border-line text-red-600 hover:bg-red-50",
};

const SIZES: Record<ButtonSize, string> = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-2 text-sm",
};

/** 生成按钮类名：`<Button>` 内部用，`<Link>` 也可套用同款外观。 */
export function buttonVariants(opts?: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
}): string {
    const { variant = "primary", size = "md", className } = opts ?? {};
    return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

/**
 * 统一按钮。`type="submit"` 时内部换用提交态实现（禁用 + 转圈），
 * 这样全站 33 处 `<Button type="submit">` 调用点无需任何修改就拿到“点了立刻有反馈”，
 * 顺带堵住重复提交（标记发货 / 新增商品 / 改价 被点两次是真风险）。
 */
export function Button({ variant, size, className, type, children, ...props }: ButtonProps) {
    const cls = buttonVariants({ variant, size, className });
    if (type === "submit") {
        return (
            <SubmitButton className={cls} {...props}>
                {children}
            </SubmitButton>
        );
    }
    return (
        <button type="button" className={cls} {...props}>
            {children}
        </button>
    );
}
