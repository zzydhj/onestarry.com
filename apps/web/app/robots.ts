import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@onestarry/core";

/**
 * 前台 robots：全站可索引，屏蔽账户/交易/接口路径；挂上动态 sitemap。
 *
 * ⚠ `/order` 与 `/pay` 必须在 disallow 里（2026-10-23 审查 P0-1）：订单确认页含客户邮箱与购物内容，
 * 支付页含金额与商品；两页都已加页级 `robots: {index:false}`，这里再挡一层爬取。
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/cart", "/checkout", "/order", "/pay", "/api"] }],
        sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    };
}
