import type { NextConfig } from "next";
import { buildStamp } from "../../scripts/build-stamp.mjs";

const nextConfig: NextConfig = {
    // 图片走 Cloudflare Images / R2 loader（后续接）；先不启用 Vercel 优化器
    images: { unoptimized: true },
    // 内部 workspace 包以 TS 源码导出，需让 Next 转译
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/ui"],
    // 构建期注入提交号与构建时间，供 /api/health 回答“线上跑的是哪个版本”（放量时用）
    env: buildStamp(),
    // 安全响应头（全路由附加头）。注：ISR 页 s-maxage 是剩余新鲜度倒计时，
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
            // ⚠ 下面两条是开 Workers Cache（wrangler.jsonc 的 cache.enabled）的前提。
            // 那层缓存挡在 Worker 前面，只看**响应头**决定存不存；而这两组端点原本**不带任何
            // Cache-Control**（实测），按 RFC 9111 就会走启发式新鲜度 —— 健康检查、外部集成 API
            // 边界这类东西被缓存住哪怕几秒都是坑（而且它们不读 cookie，拿不到 Next 那份 no-store 保护）。
            // 其余个性化页（/cart /checkout /order/* /account/* /search）本来就有 Next 发的
            // private,no-cache,no-store，不需要在这里叠。
            { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
            { source: "/integration/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
            // ⚠ 全静态 HTML 页的边缘 TTL 必须压住。Next 对“无任何动态 API”的页发
            // `s-maxage=31536000`（**一年**），而 HTML 里引用的 chunk 路径带 buildId —— 下次部署旧 chunk 就没了。
            // 边缘会不会在部署时自动清掉，官方文档未写、实测也不够决定（anycast 会换 PoP），
            // 所以**不依赖那个未知行为**：把这类页的边缘窗口压到 5 分钟，代价可忽略（登录页本来就没流量）。
            // 新增全静态页时要同步加一条 —— `packages/core/src/site-status.test.ts` 会拦住漏加的。
            { source: "/signin", headers: [{ key: "Cache-Control", value: "public, max-age=0, s-maxage=300, must-revalidate" }] },
        ];
    },
};

export default nextConfig;
