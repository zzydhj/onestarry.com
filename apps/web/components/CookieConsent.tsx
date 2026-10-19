"use client";

import { useEffect, useState } from "react";
import { readConsent, saveConsent } from "@/lib/consent";

/** 全站 Cookie 同意横幅：无同意记录时弹出；选择写入第一方 cookie。分析脚本据 hasConsent 再加载。 */
export function CookieConsent() {
    const [open, setOpen] = useState(false);
    const [showPrefs, setShowPrefs] = useState(false);
    const [analytics, setAnalytics] = useState(true);
    const [marketing, setMarketing] = useState(false);

    // 仅在客户端挂载后判断，避免 SSR 与首帧水合不一致（初始恒不渲染）。
    useEffect(() => {
        if (!readConsent()) setOpen(true);
    }, []);

    if (!open) return null;

    const decide = (a: boolean, m: boolean) => {
        saveConsent({ analytics: a, marketing: m });
        setOpen(false);
    };

    return (
        <div
            role="dialog"
            aria-live="polite"
            aria-label="Cookie consent"
            className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
        >
            <div className="mx-auto max-w-5xl px-4 py-4">
                <p className="text-sm text-fg">
                    We use cookies to keep your cart working and improve your experience, and — only with your
                    consent — to analyze site usage. Accept all, use essential only, or customize your preferences.
                </p>

                {showPrefs && (
                    <div className="mt-3 space-y-2 text-sm text-muted">
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked disabled />
                            <span>Essential — cart &amp; security (always on)</span>
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={analytics}
                                onChange={(e) => setAnalytics(e.target.checked)}
                            />
                            <span>Analytics — helps us understand which products are popular</span>
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={marketing}
                                onChange={(e) => setMarketing(e.target.checked)}
                            />
                            <span>Marketing — personalized ads (not yet enabled)</span>
                        </label>
                    </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => decide(true, true)}
                        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    >
                        Accept all
                    </button>
                    <button
                        onClick={() => decide(false, false)}
                        className="rounded-md border border-line px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                        Essential only
                    </button>
                    {showPrefs ? (
                        <button
                            onClick={() => decide(analytics, marketing)}
                            className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition hover:bg-surface"
                        >
                            Save preferences
                        </button>
                    ) : (
                        <button
                            onClick={() => setShowPrefs(true)}
                            className="px-2 py-2 text-sm text-muted underline transition hover:text-fg"
                        >
                            Customize preferences
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
