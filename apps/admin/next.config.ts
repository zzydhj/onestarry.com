import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: { unoptimized: true },
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/jobs", "@onestarry/shared", "@onestarry/ui"],
};

export default nextConfig;
