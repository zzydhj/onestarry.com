import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
    title: "onestarry.com",
    description: "Global e-commerce template — Next.js on Cloudflare Workers",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen bg-white text-fg antialiased">
                <SiteHeader />
                {children}
            </body>
        </html>
    );
}
