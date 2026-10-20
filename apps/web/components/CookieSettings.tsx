"use client";

import { CONSENT_COOKIE } from "@/lib/consent";

/** 清除已记录的同意并重载 → 横幅重新弹出，让用户改选（GDPR 要求同意可撤回）。 */
export function CookieSettings() {
    const open = () => {
        document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
        location.reload();
    };
    return (
        <button type="button" onClick={open} className="transition hover:text-accent">
            Cookie settings
        </button>
    );
}
