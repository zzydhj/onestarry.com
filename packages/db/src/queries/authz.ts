import { and, eq, inArray } from "drizzle-orm";
import { permissions, principalRoles, rolePermissions, roles } from "../schema";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type PermissionKey, type RoleKey } from "@onestarry/core";
import type { Db, Tx } from "../client";

/**
 * authz.ts —— RBAC 读写（§3.5 / 步骤 6）。权限点真源在 @onestarry/core 的 rbac.ts；
 * 这里负责把定义 seed 进库、查某主体的权限集、分配/移除角色。
 */

const ROLE_NAMES: Record<RoleKey, string> = {
    super_admin: "Super Admin",
    staff: "Staff",
    customer: "Customer",
};

/**
 * 幂等 seed：内置角色 + 全部权限点 + 角色→权限映射（映射按 core 定义重建，保证与代码一致）。
 * 在 seed-admin 里调用，DDL 走表主连接。
 */
export async function seedRbac(db: Db | Tx): Promise<void> {
    for (const key of Object.values(ROLES)) {
        await db.insert(roles).values({ key, name: ROLE_NAMES[key], isSystem: true }).onConflictDoNothing();
    }
    for (const p of Object.values(PERMISSIONS)) {
        await db.insert(permissions).values({ key: p }).onConflictDoNothing();
    }
    const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, Object.values(ROLES)));
    const permRows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
    const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));
    const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]));
    for (const [roleKey, perms] of Object.entries(ROLE_PERMISSIONS) as [RoleKey, PermissionKey[]][]) {
        const roleId = roleIdByKey.get(roleKey);
        if (!roleId) continue;
        await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId)); // 重建，与代码定义对齐
        for (const pk of perms) {
            const permissionId = permIdByKey.get(pk);
            if (permissionId) await db.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
        }
    }
}

/** 某主体的权限集（默认后台 kind=admin）。空集 = 无任何后台权限。 */
export async function getPrincipalPermissions(
    db: Db | Tx,
    subjectId: string,
    kind: "customer" | "admin" = "admin",
): Promise<Set<PermissionKey>> {
    const rows = await db
        .select({ key: permissions.key })
        .from(principalRoles)
        .innerJoin(roles, eq(principalRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(eq(principalRoles.subjectId, subjectId), eq(principalRoles.kind, kind)));
    return new Set(rows.map((r) => r.key as PermissionKey));
}

/** 某主体的角色 key 列表。 */
export async function getPrincipalRoles(
    db: Db | Tx,
    subjectId: string,
    kind: "customer" | "admin" = "admin",
): Promise<RoleKey[]> {
    const rows = await db
        .select({ key: roles.key })
        .from(principalRoles)
        .innerJoin(roles, eq(principalRoles.roleId, roles.id))
        .where(and(eq(principalRoles.subjectId, subjectId), eq(principalRoles.kind, kind)));
    return rows.map((r) => r.key as RoleKey);
}

/** 给主体分配角色（幂等）。roleKey 须已 seed。 */
export async function assignRole(
    db: Db | Tx,
    input: { subjectId: string; roleKey: RoleKey; kind?: "customer" | "admin" },
): Promise<void> {
    const role = (await db.select({ id: roles.id }).from(roles).where(eq(roles.key, input.roleKey)).limit(1))[0];
    if (!role) throw new Error(`ROLE_MISSING:${input.roleKey}`);
    await db
        .insert(principalRoles)
        .values({ subjectId: input.subjectId, kind: input.kind ?? "admin", roleId: role.id })
        .onConflictDoNothing();
}

/** 移除主体某角色（只删映射行，不动角色定义）。 */
export async function revokeRole(
    db: Db | Tx,
    input: { subjectId: string; roleKey: RoleKey; kind?: "customer" | "admin" },
): Promise<void> {
    const kind = input.kind ?? "admin";
    const role = (await db.select({ id: roles.id }).from(roles).where(eq(roles.key, input.roleKey)).limit(1))[0];
    if (!role) return;
    await db
        .delete(principalRoles)
        .where(and(eq(principalRoles.subjectId, input.subjectId), eq(principalRoles.kind, kind), eq(principalRoles.roleId, role.id)));
}
