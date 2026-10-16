import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
    title: "onestarry.com",
    description: "Global e-commerce template — Next.js on Cloudflare Workers",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
        </html>
    );
}
