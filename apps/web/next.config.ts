import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // 图片走 Cloudflare Images / R2 loader（后续接）；先不启用 Vercel 优化器
    images: { unoptimized: true },
    // 内部 workspace 包以 TS 源码导出，需让 Next 转译
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/shared", "@onestarry/ui"],
    // 安全响应头（全路由，均为附加头、不碰 Cache-Control→不伤 ISR/边缘缓存）。
    // 暂不加严格 CSP（需 nonce/strict-dynamic，易与 Next 水合/内联样式冲突），留待需要时专项做。
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
