import type { MetadataRoute } from "next";

/** 前台 robots：全站可索引，屏蔽账户/交易/接口路径。sitemap 待 jobs 侧 cron 生成后再挂。 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/cart", "/checkout", "/api"] }],
    };
}
