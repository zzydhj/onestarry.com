import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // 图片走 Cloudflare Images / R2 loader（后续接）；先不启用 Vercel 优化器
    images: { unoptimized: true },
    // 内部 workspace 包以 TS 源码导出，需让 Next 转译
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/shared"],
};

export default nextConfig;
