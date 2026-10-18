import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AdminNav } from "@/components/AdminNav";

export const metadata: Metadata = {
    title: "onestarry · Admin",
    description: "OneStarry 管理后台",
    robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="zh">
            <body className="min-h-screen bg-white text-fg antialiased">
                <AdminNav />
                {children}
            </body>
        </html>
    );
}
