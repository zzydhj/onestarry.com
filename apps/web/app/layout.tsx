import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_NAME, SITE_ORIGIN } from "@onestarry/core";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CookieConsent } from "@/components/CookieConsent";

export const metadata: Metadata = {
    metadataBase: new URL(SITE_ORIGIN),
    title: { default: `${SITE_NAME}.com`, template: `%s · ${SITE_NAME}` },
    description: "Global e-commerce storefront — quality goods shipped worldwide from our own warehouse.",
    openGraph: { siteName: SITE_NAME, type: "website" },
    robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen bg-white text-fg antialiased">
                <SiteHeader />
                {children}
                <SiteFooter />
                <CookieConsent />
            </body>
        </html>
    );
}
