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
            // ⚠ 别给全静态页（如 /signin）叠 Cache-Control 头去“压边缘 TTL”——已实测过，是错的修法。
            // 背景：Next 对全静态页发 `s-maxage=31536000`（一年），看上去像“边缘会端一年旧 HTML、
            // 而旧 HTML 引用的 chunk 带 buildId”。但这个风险已被另一条性质关掉：
            // **Workers Cache 的缓存键默认含 Worker 版本** → 部署即换新命名空间（见 docs/PERF.md §6）。
            // 2026-10-22 试过给它叠 `s-maxage=300, must-revalidate`：线上实际变成
            // `x-nextjs-cache: HIT` + 恒定 `s-maxage=1`（连打 5 发不倒数）—— 既不是写的值、也拿不出文档解释
            // （OpenNext 重写 ISR 头与 next.config headers() 的先后关系未知），后果比原状更差（边缘几乎不存）。
            // 所以回退。规矩：这里只用来给**本来不带头**的端点补 no-store，不要动已有缓存语义的页。
        ];
    },
};

export default nextConfig;
