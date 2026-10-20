import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // 图片走 Cloudflare Images / R2 loader（后续接）；先不启用 Vercel 优化器
    images: { unoptimized: true },
    // 内部 workspace 包以 TS 源码导出，需让 Next 转译
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/shared", "@onestarry/ui"],
    // 安全响应头（全路由附加头，不碰 Cache-Control）。注：ISR 页 s-maxage 是剩余新鲜度倒计时，
    // 接近过期时看到小值属正常，非缓存回归。暂不加严格 CSP（需 nonce，易与 Next 水合冲突）。
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "X-Frame-Options", value: "SAMEORIGIN" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
                    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
                ],
            },
        ];
    },
};

export default nextConfig;
