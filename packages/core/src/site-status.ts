/**
 * 站点运行态登记表（单一真源）。
 *
 * 为什么放在 core：后台「站点状态」页、架构文档、CI 守卫测试必须读**同一份事实**。
 * 2026-10-22 那次缓存事故的根因之一就是"约定散落在人脑里"（新增读页忘了 `generateStaticParams`
 * 会静默退化成恒 STALE，不报错、内容还照对）—— 见 docs/PERF.md §7 与架构方案 §22。
 * 所以这里不只是给页面看的清单，它同时是 `site-status.test.ts` 里漂移守卫的比对基准。
 *
 * ⚠ 本文件是**声明**，不是探测结果。真实运行态来自 `/api/health`（版本、ISR verdict）与探针。
 *   两者不一致 = 代码或文档说谎，守卫测试会让它变红。
 */

/** 渲染策略。决定"内容多久变新"与"边缘会不会存"。 */
export type RenderKind = "static" | "prerender-isr" | "dynamic" | "private";

export const RENDER_KIND_LABELS: Record<RenderKind, string> = {
    static: "全静态（构建期生成一次，改代码才变）",
    "prerender-isr": "整页 ISR（构建期预渲染 + 窗口后台刷新）",
    dynamic: "动态（每次请求渲染，无缓存）",
    private: "私有（读会话/写状态，必须 no-store）",
};

/** 失效由谁推动。⚠ "channel" 对预渲染条目**无效**（免疫），只作提前量 —— 见 docs/PERF.md §7。 */
export type InvalidationKind = "timer" | "timer+channel" | "none";

export const INVALIDATION_LABELS: Record<InvalidationKind, string> = {
    timer: "仅窗口到期（≤revalidate 秒后自动刷新）",
    "timer+channel": "窗口 + 后台保存即时通知（预渲染条目仍只认窗口）",
    none: "不参与缓存",
};

export interface SiteRoute {
    /** 前台路径模式（与 Next 路由树一致）。 */
    path: string;
    /** 源文件（相对仓库根）—— 漂移守卫用它定位真实代码。 */
    file: string;
    label: string;
    kind: RenderKind;
    /** `export const revalidate` 的秒数；无 ISR 参与时为 null。 */
    revalidateSec: number | null;
    /** 边缘（Workers Cache）会不会存：完全由响应头决定，no-store ⇒ BYPASS。 */
    edgeCacheable: boolean;
    invalidation: InvalidationKind;
    /** 路径含 `[param]`：这类若 kind 是 prerender-isr，就必须有 generateStaticParams（守卫强制）。 */
    dynamicSegment?: boolean;
    note?: string;
}

/**
 * 全站路由登记。依据 2026-10-22 的构建路由表 + 线上响应头实测，不是推测。
 * 顺序 = 后台展示顺序（公开读页在前，交易/私有在后，接口最后）。
 */
export const SITE_ROUTES: SiteRoute[] = [
    {
        path: "/",
        file: "apps/web/app/page.tsx",
        label: "首页",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        note: "构建期连真库预渲染（CI 注入 DATABASE_URL），运行期 60s 后台刷新",
    },
    {
        path: "/products",
        file: "apps/web/app/products/page.tsx",
        label: "商品列表",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
    },
    {
        path: "/products/[slug]",
        file: "apps/web/app/products/[slug]/page.tsx",
        label: "商品详情（PDP）",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        dynamicSegment: true,
        note: "本轮事故的起点：原先 generateStaticParams 返回 [] 走按需 ISR → 恒 STALE",
    },
    {
        path: "/categories",
        file: "apps/web/app/categories/page.tsx",
        label: "类目索引",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
    },
    {
        path: "/categories/[slug]",
        file: "apps/web/app/categories/[slug]/page.tsx",
        label: "类目页",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        dynamicSegment: true,
    },
    {
        path: "/brands",
        file: "apps/web/app/brands/page.tsx",
        label: "品牌索引",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
    },
    {
        path: "/brands/[slug]",
        file: "apps/web/app/brands/[slug]/page.tsx",
        label: "品牌页",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        dynamicSegment: true,
    },
    {
        path: "/blog",
        file: "apps/web/app/blog/page.tsx",
        label: "博客列表",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
    },
    {
        path: "/blog/[slug]",
        file: "apps/web/app/blog/[slug]/page.tsx",
        label: "博文详情",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        dynamicSegment: true,
        note: "2026-10-22 补 generateStaticParams（此前一直恒 STALE）",
    },
    {
        path: "/legal/[type]",
        file: "apps/web/app/legal/[type]/page.tsx",
        label: "法律文档",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        dynamicSegment: true,
        note: "窗口从 3600 收到 60：预渲染条目叫不动 revalidatePath，留一小时=运营改完等一小时",
    },
    {
        path: "/[slug]",
        file: "apps/web/app/[slug]/page.tsx",
        label: "CMS 单页 / 落地页",
        kind: "prerender-isr",
        revalidateSec: 60,
        edgeCacheable: true,
        invalidation: "timer+channel",
        dynamicSegment: true,
        note: "具名段优先，不劫持；新增 app/ 顶层目录要同步页内 RESERVED 集合",
    },
    {
        path: "/search",
        file: "apps/web/app/search/page.tsx",
        label: "站内搜索",
        kind: "dynamic",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        note: "读 query → 每次渲染；响应 no-store，边缘 BYPASS",
    },
    {
        path: "/cart",
        file: "apps/web/app/cart/page.tsx",
        label: "购物车",
        kind: "private",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        note: "Cookie 购物车，绝不能被缓存住别人的内容",
    },
    {
        path: "/checkout",
        file: "apps/web/app/checkout/page.tsx",
        label: "结账",
        kind: "private",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
    },
    {
        path: "/order/[orderNumber]",
        file: "apps/web/app/order/[orderNumber]/page.tsx",
        label: "订单确认",
        kind: "private",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        dynamicSegment: true,
    },
    {
        path: "/account/orders",
        file: "apps/web/app/account/orders/page.tsx",
        label: "我的订单",
        kind: "private",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
    },
    {
        path: "/signin",
        file: "apps/web/app/signin/page.tsx",
        label: "前台登录",
        kind: "static",
        revalidateSec: null,
        edgeCacheable: true,
        invalidation: "none",
        note: "全静态页：Next 发 s-maxage=31536000（一年）。看着危，实则被“Workers Cache 缓存键含 Worker 版本”关掉（部署即换命名空间）。⚠ 别去叠 headers() 压它：2026-10-22 实测会把页推进 ISR 重写路径、变成恒定 s-maxage=1（已回退）",
    },
    {
        path: "/api/health",
        file: "apps/web/app/api/health/route.ts",
        label: "健康端点",
        kind: "dynamic",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        note: "不查库：依赖故障时也要能答；放量判别靶子",
    },
    {
        path: "/api/internal/invalidate",
        file: "apps/web/app/api/internal/invalidate/route.ts",
        label: "跨 Worker 失效入口",
        kind: "dynamic",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        note: "共享密钥 fail-closed（没配一律 401）+ 白名单 + ≤20 条",
    },
    {
        path: "/products/[slug]/review",
        file: "apps/web/app/products/[slug]/review/page.tsx",
        label: "发表评价页",
        kind: "private",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        dynamicSegment: true,
        note: "force-dynamic + 读客户会话：不能被缓存（缓存住就是把 A 的表单给了 B）",
    },
    {
        path: "/integration/*",
        file: "apps/web/app/integration",
        label: "对外集成 API",
        kind: "dynamic",
        revalidateSec: null,
        edgeCacheable: false,
        invalidation: "none",
        note: "next.config headers() 显式 no-store：它们不读 cookie，拿不到 Next 的自动保护",
    },
];

/** 缓存分层。判读线上响应时必须按层看，混在一体会得出错误结论（docs/PERF.md §6/§7）。 */
export interface CacheLayer {
    name: string;
    where: string;
    ttlSource: string;
    /** 谁能提前打破它。 */
    brokenBy: string;
    note: string;
}

export const CACHE_LAYERS: CacheLayer[] = [
    {
        name: "浏览器",
        where: "访客本机",
        ttlSource: "Cache-Control 的 max-age（本站 HTML 不下发 max-age）",
        brokenBy: "硬刷新",
        note: "交易页是 private,no-cache,no-store → 完全不存",
    },
    {
        name: "边缘 Workers Cache",
        where: "Cloudflare 离访客最近的 PoP，在 Worker 之前",
        ttlSource: "响应里的 s-maxage（= ISR 条目的**剩余**新鲜度）",
        brokenBy: "等 TTL / 手动 purge（本站未接）",
        note: "命中时 Worker 不运行。⚠ 不受 revalidatePath 管辖。缓存键含 Worker 版本 → 部署自动换命名空间（旧 HTML 不会被端下去）",
    },
    {
        name: "R2 整页 ISR",
        where: "onestarry-isr-cache 桶，前缀 incremental-cache/<buildId>/",
        ttlSource: "页里的 export const revalidate",
        brokenBy: "窗口到期；构建期上传的条目**不响应** revalidatePath",
        note: "唯一决定「内容何时变新」的一层。每次部署换 buildId ⇒ 旧条目整批作废（冷启动）",
    },
    {
        name: "Hyperdrive 查询缓存",
        where: "Cloudflare Hyperdrive",
        ttlSource: "关闭中（caching.disabled=true）",
        brokenBy: "—",
        note: "刻意不开：写操作不会使缓存失效，会拿到最多 60s+15s 前的结果（docs/PERF.md §7）",
    },
];

/** 定时任务登记（表达式须与 apps/jobs/wrangler.jsonc 的 crons 一致，守卫测试会比对）。 */
export interface SiteCron {
    cron: string;
    worker: string;
    does: string;
    /** 挂了会怎样 —— 让运维知道严重程度。 */
    impact: string;
}

export const SITE_CRONS: SiteCron[] = [
    { cron: "* * * * *", worker: "onestarry-jobs", does: "消费 outbox 待办事件（改价→重算 variant_market_prices）", impact: "改价/税率不会落到前台价，最长延迟=人工补跑" },
    { cron: "*/5 * * * *", worker: "onestarry-jobs", does: "ISR 健康探针：连打公开读页，结论写 R2", impact: "缓存链路坏了没人知道（这正是它存在的理由）" },
    { cron: "20 4 * * *", worker: "onestarry-jobs", does: "数据保留清理 + 删除历史 buildId 遗留的 ISR 条目", impact: "R2 对象无限增长（实测曾积 43 前缀/571 对象）" },
];

/** 三个 Worker。版本与 ISR 结论都由各自 /api/health 实时回答。 */
export interface SiteWorker {
    name: string;
    role: string;
    url: string;
    /** 没有独立对外健康端点的（如 jobs 只有 workers.dev）留 null。 */
    healthUrl: string | null;
}

export const SITE_WORKERS: SiteWorker[] = [
    { name: "onestarry-com", role: "前台（Next + OpenNext）", url: "https://onestarry.com", healthUrl: "https://onestarry.com/api/health" },
    { name: "onestarry-admin", role: "后台（Next + OpenNext）", url: "https://admin.onestarry.com", healthUrl: "https://admin.onestarry.com/api/health" },
    { name: "onestarry-jobs", role: "cron：relay / 探针 / 清理", url: "—", healthUrl: null },
];

/** 运行时依赖（绑定与 secret）。configured 由 health 端点回答，本表说明"该有什么、缺了会怎样"。 */
export interface SiteBinding {
    binding: string;
    worker: string;
    what: string;
    missing: string;
}

export const SITE_BINDINGS: SiteBinding[] = [
    { binding: "HYPERDRIVE", worker: "web / admin / jobs", what: "Neon 连接（走 app_rw 角色）", missing: "全站 500" },
    { binding: "NEXT_INC_CACHE_R2_BUCKET → onestarry-isr-cache", worker: "web", what: "整页 ISR 成品页", missing: "ISR 写不进去 → 每次全额渲染" },
    { binding: "NEXT_CACHE_DO_QUEUE（DO）", worker: "web", what: "OpenNext 的再验证队列", missing: "后台重渲染不排队 → 惊群回源" },
    { binding: "MEDIA → onestarry-media", worker: "web / admin", what: "商品图 R2 桶", missing: "图片全裂" },
    { binding: "INVALIDATE_SECRET", worker: "web + admin（同值）", what: "跨 Worker 失效通道的共享密钥", missing: "通道整条 401 → 退化为「只靠窗口追平」，不影响正确性" },
];

/** 公开读页（该被缓存的），后台状态页与守卫都用它筛。 */
export function publicReadRoutes(): SiteRoute[] {
    return SITE_ROUTES.filter((r) => r.kind === "prerender-isr" || r.kind === "static");
}

/** 必须提供 generateStaticParams 的路由：动态段 + 声明为预渲染 ISR。 */
export function routesRequiringStaticParams(): SiteRoute[] {
    return SITE_ROUTES.filter((r) => r.dynamicSegment && r.kind === "prerender-isr");
}

/** 秒 → 人话（60→"60 秒"而不是"1 分钟"：全站窗口就是 60 秒，写成分钟会让人误以为改了）。 */
export function formatRevalidate(sec: number | null): string {
    if (sec === null) return "—";
    if (sec <= 120) return `${sec} 秒`;
    if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
    if (sec < 86400) return `${Math.round(sec / 3600)} 小时`;
    return `${Math.round(sec / 86400)} 天`;
}

/** 全站"改完多久可见"的最坏上界 = 公开读页里最大的 revalidate 窗口。 */
export function worstPropagationSeconds(): number {
    return publicReadRoutes().reduce((max, r) => Math.max(max, r.revalidateSec ?? 0), 0);
}
