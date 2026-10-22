"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const DEBOUNCE_MS = 350;

/**
 * 搜索框：防抖 + 软导航（不整页刷），并在等待期保留上一次结果。
 *
 * 为什么不用原生 `<form action="/search" method="get">`：那是**整文档导航**，每次搜索都要
 * 重新下载 HTML + 重新引导 JS + 输入框被服务端渲染的旧值覆盖（焦点丢失、光标跳走）。
 * 改成 `router.push` 走 RSC 软导航：页面壳与输入框留在原地，只有结果区被替换。
 *
 * 防抖 350ms：搜索词是人在打的，逐字打等于每字发一次请求；合并成"停下再查一次"。
 * 回车 / 点按钮则**立刻**发（不等防抖），因为那是明确的"就这样搜"信号。
 */
export function SearchBox({ initial }: { initial: string }) {
    const router = useRouter();
    const [value, setValue] = useState(initial);
    const [pending, start] = useTransition();
    const first = useRef(true);

    function go(q: string) {
        const trimmed = q.trim();
        start(() => router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search", { scroll: false }));
    }

    useEffect(() => {
        // 首次挂载不导航（否则会把自己刚渲染的页面又推一遍）
        if (first.current) {
            first.current = false;
            return;
        }
        const t = setTimeout(() => go(value), DEBOUNCE_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                go(value);
            }}
            className="mt-4 flex max-w-md gap-2"
            role="search"
        >
            <input
                type="search"
                name="q"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Search products…"
                aria-label="Search products"
                className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
                {pending ? "Searching…" : "Search"}
            </button>
        </form>
    );
}
