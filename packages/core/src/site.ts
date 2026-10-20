/**
 * 站级常量单一真源。换品牌/域名时，前台所有 canonical/OG/sitemap/robots/JSON-LD/标题模板
 * 与商品图 CDN 都从这里派生 —— 只改这一个文件即可（见 docs/REBRAND.md）。
 */

/** 站点规范来源（scheme+host，无尾斜杠）。用于 metadataBase / canonical / sitemap / robots / JSON-LD。 */
export const SITE_ORIGIN = "https://onestarry.com";

/** 品牌名。用于标题模板 `%s · name`、og:site_name、WebSite/Organization 结构化数据。 */
export const SITE_NAME = "onestarry";

/** R2 公开桶的公网访问基址（绑定的自定义域）。图片 URL 的单一真源，media.ts 从此引用。 */
export const MEDIA_PUBLIC_BASE = "https://media.onestarry.com";
