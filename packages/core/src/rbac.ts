/**
 * rbac.ts —— 权限点与角色的单一真源（纯常量，无 DB 依赖，前后端/seed/core 共用）。
 * 对应 schema/authz.ts 的三档 RBAC；权限点在服务层强制（非仅前端隐藏）。见 §3.5 / §15 步骤 6。
 */

/** 权限点 key。命名 `域:动作`，与 authz.ts permissions.key 一致。 */
export const PERMISSIONS = {
    productWrite: "product:write", // 商品增删改/上下架/库存/图片/归属
    orderWrite: "order:write", // 订单处理/发货
    refundWrite: "refund:write", // 退款（敏感）
    categoryWrite: "category:write", // 类目/品牌/属性/目录
    marketWrite: "market:write", // 市场/税则/运费配置（敏感）
    seoWrite: "seo:write", // SEO / 法律文档
    roleManage: "role:manage", // 团队成员/角色分配（super_admin 专属）
    configWrite: "config:write", // 系统级配置 / PSP 启用（super_admin 专属）
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** 内置角色 key（与 roles.key 一致）。customer 为前台档，不进后台、无后台权限。 */
export const ROLES = {
    superAdmin: "super_admin",
    staff: "staff",
    customer: "customer",
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/** 角色 → 权限集。super_admin 全权；staff 日常运营（不含退款/市场/角色/系统配置）。 */
export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
    super_admin: Object.values(PERMISSIONS),
    staff: [PERMISSIONS.productWrite, PERMISSIONS.orderWrite, PERMISSIONS.categoryWrite, PERMISSIONS.seoWrite],
    customer: [],
};

/** 某角色是否含某权限（纯函数，供 core 服务层与前端隐藏判断）。 */
export function roleHasPermission(role: RoleKey, perm: PermissionKey): boolean {
    return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
