/**
 * schema/authz.ts —— 三档 RBAC 与用户档案（§15 步骤 6）
 * 角色：customer / staff / super_admin（内置）+ 自定义。
 * 权限点在 core 服务层强制（非仅前端隐藏）。
 * Better Auth 自身的 user/session/account 表由 better-auth 管理（下一步接入），
 * 这里用 subjectId(uuid) 关联，不建外键到 auth 表，避免跨依赖。
 */
import { pgTable, pgEnum, uuid, text, boolean, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, timestamps } from "./columns";
import { markets } from "./foundation";

export const principalKindEnum = pgEnum("principal_kind", ["customer", "admin"]);

export const roles = pgTable(
  "roles",
  {
    ...timestamps(),
    id: id(),
    key: text("key").notNull(), // customer | staff | super_admin | 自定义
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
  },
  (t) => [uniqueIndex("role_key_uq").on(t.key)],
);

export const permissions = pgTable(
  "permissions",
  {
    ...timestamps(),
    id: id(),
    key: text("key").notNull(), // order:write | refund:write | config:tax:write | role:manage ...
    description: text("description"),
  },
  (t) => [uniqueIndex("permission_key_uq").on(t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] }), index("rp_permission_idx").on(t.permissionId)],
);

// 主体(auth user) → 角色 的映射（customer/admin 两套实例共用此表，kind 区分）
export const principalRoles = pgTable(
  "principal_roles",
  {
    ...timestamps(),
    id: id(),
    subjectId: uuid("subject_id").notNull(), // Better Auth 用户 id
    kind: principalKindEnum("kind").notNull(),
    roleId: uuid("role_id").notNull().references(() => roles.id),
  },
  (t) => [uniqueIndex("pr_subject_kind_role_uq").on(t.subjectId, t.kind, t.roleId), index("pr_subject_idx").on(t.subjectId, t.kind)],
);

export const customerProfiles = pgTable(
  "customer_profiles",
  {
    ...timestamps(),
    id: id(),
    userId: uuid("user_id").notNull(), // Better Auth customer 用户 id
    preferredLocale: text("preferred_locale").notNull().default("en"),
    preferredMarketId: uuid("preferred_market_id").references(() => markets.id),
    marketingOptInRef: text("marketing_opt_in_ref"), // 指向 consents 记录
  },
  (t) => [uniqueIndex("cp_user_uq").on(t.userId)],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  principalRoles: many(principalRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));
