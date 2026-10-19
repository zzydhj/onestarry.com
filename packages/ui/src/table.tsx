import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/** 带边框 + 横向滚动的表格外壳（放 <table> 用）。 */
export function TableFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("overflow-x-auto rounded-xl border border-line", className)} {...props} />;
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
    return <thead className={cn("border-b border-line text-left text-muted", className)} {...props} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
    return <th className={cn("px-4 py-2 font-medium", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
    return <tr className={cn("border-b border-line last:border-0", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
    return <td className={cn("px-4 py-2", className)} {...props} />;
}
