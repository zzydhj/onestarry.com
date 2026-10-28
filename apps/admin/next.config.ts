import type { NextConfig } from "next";
import { buildStamp } from "../../scripts/build-stamp.mjs";
import { securityHeaders } from "../../scripts/security-headers.mjs";

const nextConfig: NextConfig = {
    images: { unoptimized: true },
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/jobs", "@onestarry/ui"],
    // 与 web 同源：构建期注入提交号/构建时间，供 /api/health 判别线上版本
    env: buildStamp(),
    // 安全响应头（审查 H-2）：此前 admin 一项都没有 → /signin 可被任意站点 iframe 嵌套（点击劫持管理员凭据）、无 HSTS。
    // 后台取最严的 X-Frame-Options: DENY（任何帧都不该有）；与 web 共用同一份头，避免两处漂移。
    async headers() {
        return [{ source: "/:path*", headers: securityHeaders({ denyFraming: true }) }];
    },
};

export default nextConfig;
