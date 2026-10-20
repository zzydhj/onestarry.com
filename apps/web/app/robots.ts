import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@onestarry/core";

/** 前台 robots：全站可索引，屏蔽账户/交易/接口路径；挂上动态 sitemap。 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/cart", "/checkout", "/api"] }],
        sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    };
}
