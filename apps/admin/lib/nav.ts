import type { PermissionKey } from "@onestarry/core";

/**
 * 后台入口表的**唯一真源**（审查 L-1）。
 *
 * 为什么要单独抽出来：原先这张表只住在 `components/AdminSideNav.tsx` 里（带 `perm`），
 * 而概览页 `app/page.tsx` 另抄了一份**没有 perm 的 8 卡片表**。两份表各自演化，结果就是
 * 概览页把「市场配置」「团队权限」画给了没有 `market:write` / `role:manage` 的 staff ——
 * 点进去 `requirePermission` 直接抛 `FORBIDDEN:<perm>` 撞错误边界。导航会过滤、概览不会，
 * 同一条规则写两遍必然漂移，所以这里收成一个模块，两边都读它。
 *
 * ⚠ 这里只定义**入口与可见性**，不做任何强制：真正的闸在各页 `requirePermission`
 *   与 Server Action 里（隐藏入口只是体验，见 §4 覆盖矩阵）。
 */

/** 一个入口 + 它所需权限点（无 perm = 任意已登录后台账号可见）。与页面/动作的 requirePermission 一一对应。 */
export interface NavItem {
    href: string;
    label: string;
    perm?: PermissionKey;
    /** 徽标文案（如"新"）——只放稳定信息，实时状态放页面里。 */
    badge?: string;
    /** 是否同时在「概览」页画成快捷卡片。缺省 false：概览只放主干模块，子入口（新建/导入）留给导航。 */
    card?: boolean;
    /** 概览卡片下方的一行说明（可选）。 */
    hint?: string;
}

/** 分组 = ERP 后台的二级结构。组的可见性由"组内是否还有可见项"决定，不单独配权限。 */
export interface NavGroup {
    id: string;
    label: string;
    items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
    {
        id: "home",
        label: "总览",
        items: [
            { href: "/", label: "概览" },
            { href: "/status", label: "站点状态", perm: "config:write", badge: "缓存 · 版本 · 定时" },
        ],
    },
    {
        id: "catalog",
        label: "商品",
        items: [
            { href: "/products", label: "商品管理", perm: "product:write", card: true, hint: "改价 / 上下架 / 库存 / 新建 / 图片 / 图文详情 / 批量导入 均在此内" },
            { href: "/products/new", label: "新建商品", perm: "product:write" },
            { href: "/products/import", label: "批量导入", perm: "product:write" },
            { href: "/reviews", label: "评论审核", perm: "product:write", card: true },
        ],
    },
    {
        id: "trade",
        label: "交易",
        items: [
            { href: "/orders", label: "订单管理", perm: "order:write", card: true, hint: "详情里可「标记发货」（写库存流水 + 确认收入）" },
        ],
    },
    {
        id: "taxonomy",
        label: "目录结构",
        items: [
            { href: "/categories", label: "类目", perm: "category:write", card: true },
            { href: "/brands", label: "品牌", perm: "category:write", card: true },
            { href: "/attributes", label: "属性定义", perm: "config:write" },
        ],
    },
    {
        id: "content",
        label: "内容与合规",
        items: [
            { href: "/content", label: "内容 CMS", perm: "seo:write" },
            { href: "/legal", label: "法律文档", perm: "seo:write", card: true },
        ],
    },
    {
        id: "system",
        label: "配置与团队",
        items: [
            { href: "/markets", label: "市场", perm: "market:write", card: true },
            { href: "/team", label: "团队权限", perm: "role:manage", card: true },
        ],
    },
];

/** 入口对这份权限集是否可见。无 `perm` 的入口任何已登录后台账号都可见。 */
export function navItemVisible(item: NavItem, allowed: ReadonlySet<string>): boolean {
    return !item.perm || allowed.has(item.perm);
}

/** 概览页要画的快捷卡片：同一个表里标了 `card` 的项，且按权限过滤 —— 与导航口径严格一致。 */
export function dashboardCards(allowed: ReadonlySet<string>): NavItem[] {
    return NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.card === true && navItemVisible(i, allowed));
}
