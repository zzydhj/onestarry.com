"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";

/**
 * 悬停停留够久才预取**这一个**目标的链接。
 *
 * 为什么需要：后台整棵树是 `force-dynamic`，所有 `<Link>` 都写着 `prefetch={false}`
 * （原因记在 AdminSideNav 的注释里：进视口就预取会把侧栏所有入口各真渲染一遍，实测一次
 * 加载打出 36–45 个请求，挤干 Worker 与连接池）。代价是**点击时要现场跑一次服务端渲染**，
 * 实测 2.4–3.4 秒。原先那条注释还写着"悬停仍会预取，体感不变差"—— 2026-10-25 实测**不成立**
 * （悬停 2.5 秒、前后无任何指向该路由的请求），App Router 没有内置的悬停预取，所以那份"保险"是幻觉。
 *
 * 这里把它真的补上，并且只预取"鼠标真正停在上面的那一个"，不会重现视口预取的风暴：
 *  · 停留满 {@link DWELL_MS} 才发（扫过菜单的一串鼠标不会触发一串渲染）；
 *  · 中途移开就取消计时器；
 *  · 同一个目标一次挂载内只预取一次（`router.prefetch` 对 force-dynamic 段每次都会真取）。
 *
 * ⚠ 预取仍然是一次真渲染，所以它**不能**替代"少往返"：那才是根因（见 lib/db.ts）。
 * 这条只是把剩下的等待挪到用户还在移动鼠标的那几百毫秒里。
 */
const DWELL_MS = 150;

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

export function PrefetchLink({ href, onPointerEnter, onPointerLeave, ...rest }: Props) {
    const router = useRouter();
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requested = useRef(false);

    // 组件卸载时清掉未触发的计时器（避免在已卸载的树上 prefetch）。
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    return (
        <Link
            {...rest}
            href={href}
            prefetch={false}
            onPointerEnter={(e) => {
                onPointerEnter?.(e);
                if (requested.current || timer.current) return;
                timer.current = setTimeout(() => {
                    timer.current = null;
                    if (requested.current) return;
                    requested.current = true;
                    router.prefetch(href);
                }, DWELL_MS);
            }}
            onPointerLeave={(e) => {
                onPointerLeave?.(e);
                if (timer.current) {
                    clearTimeout(timer.current);
                    timer.current = null;
                }
            }}
        />
    );
}
