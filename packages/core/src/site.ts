/**
 * 站级常量单一真源。换品牌/域名时，前台所有 canonical/OG/sitemap/robots/JSON-LD/标题模板
 * 与商品图 CDN 都从这里派生 —— 只改这一个文件即可（见 docs/REBRAND.md）。
 */

/** 站点规范来源（scheme+host，无尾斜杠）。用于 metadataBase / canonical / sitemap / robots / JSON-LD。 */
export const SITE_ORIGIN = "https://onestarry.com";

/**
 * 后台 Worker 的来源。与前台分开一个 Worker（`onestarry-admin`），cookie 按域名隔离。
 * 用于 cron 侧的保活请求与运维面板链接，别再各处硬写域名。
 */
export const ADMIN_ORIGIN = "https://admin.onestarry.com";

/** 品牌名。用于标题模板 `%s · name`、og:site_name、WebSite/Organization 结构化数据。 */
export const SITE_NAME = "onestarry";

/** R2 公开桶的公网访问基址（绑定的自定义域）。图片 URL 的单一真源，media.ts 从此引用。 */
export const MEDIA_PUBLIC_BASE = "https://media.onestarry.com";
