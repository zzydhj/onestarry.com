import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: { unoptimized: true },
    transpilePackages: ["@onestarry/db", "@onestarry/auth", "@onestarry/core", "@onestarry/shared"],
};

export default nextConfig;
