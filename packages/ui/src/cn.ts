import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名：后者覆盖前者的冲突工具类（如 p-4 被 p-0 覆盖）。 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
