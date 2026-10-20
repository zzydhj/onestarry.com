import Link from "next/link";
import { CookieSettings } from "./CookieSettings";

/** 全站页脚：法律链接 + Cookie 设置（可撤回同意）。 */
export function SiteFooter() {
    return (
        <footer className="mt-16 border-t border-line">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
                <span>© {new Date().getFullYear()} onestarry — quality goods shipped worldwide.</span>
                <nav className="flex flex-wrap items-center gap-4">
                    <Link href="/legal/privacy" className="transition hover:text-accent">
                        Privacy
                    </Link>
                    <Link href="/legal/terms" className="transition hover:text-accent">
                        Terms
                    </Link>
                    <Link href="/legal/returns" className="transition hover:text-accent">
                        Returns
                    </Link>
                    <CookieSettings />
                </nav>
            </div>
        </footer>
    );
}
