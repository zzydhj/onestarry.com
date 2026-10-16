import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // 图片走 Cloudflare Images / R2 loader（后续接）；先不启用 Vercel 优化器
    images: { unoptimized: true },
    experimental: {
        // Server Actions 默认开启（App Router）
    },
};

export default nextConfig;
