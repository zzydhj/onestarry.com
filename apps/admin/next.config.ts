import type { NextConfig } from "next";
import { buildStamp } from "../../scripts/build-stamp.mjs";

const nextConfig: NextConfig = {
    images: { unoptimized: true },
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/jobs", "@onestarry/ui"],
    // 与 web 同源：构建期注入提交号/构建时间，供 /api/health 判别线上版本
    env: buildStamp(),
};

export default nextConfig;
