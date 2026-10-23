import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@onestarry/core";

/**
 * 前台 robots：全站可索引，屏蔽账户/交易/接口路径；挂上动态 sitemap。
 *
 * ⚠ `/order` 必须在 disallow 里（2026-10-23 审查 P0-1）：订单确认页含客户邮箱与购物内容，
 * 当时它既无页级 `robots: {index:false}`（根本没导出 metadata）、也不在屏蔽列表里，
 * 于是链接一旦被分享或从带 referer 的页面点出去，就可能连人带单进了搜索结果。
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/cart", "/checkout", "/order", "/api"] }],
        sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    };
}
