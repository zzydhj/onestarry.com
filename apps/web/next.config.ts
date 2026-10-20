import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // 图片走 Cloudflare Images / R2 loader（后续接）；先不启用 Vercel 优化器
    images: { unoptimized: true },
    // 内部 workspace 包以 TS 源码导出，需让 Next 转译
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/shared", "@onestarry/ui"],
    // 注：安全响应头故意不在此 next.config headers() 里加——实测 @opennextjs/cloudflare 会因
    // 需逐请求套用自定义头而把 ISR 页的 s-maxage 从 60 降到 2（破坏边缘缓存）。改由 Cloudflare
    // 边缘 Transform Rules 添加（在 Next 之后、不碰 Cache-Control），见架构文档 §18。
};

export default nextConfig;
