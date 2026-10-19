import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** 白底、细边框、圆角卡片容器。 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("rounded-xl border border-line bg-white", className)} {...props} />;
}
