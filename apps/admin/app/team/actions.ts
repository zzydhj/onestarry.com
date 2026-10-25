"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminAuth } from "@onestarry/auth";
import { PERMISSIONS, type RoleKey } from "@onestarry/core";
import { assignRole, listAdminMembers, revokeRole } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

/** 团队页只分配后台角色（customer 是前台档，不在此管理）。 */
const BACKEND_ROLES: RoleKey[] = ["staff", "super_admin"];
const isBackendRole = (r: string): r is RoleKey => (BACKEND_ROLES as string[]).includes(r);

/** 新建后台员工：Better Auth 建用户 + 分配角色。已存在则跳过（幂等友好）。 */
export async function createStaffAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.roleManage);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const roleKey = String(formData.get("roleKey") ?? "staff");
    if (!email || password.length < 8 || !isBackendRole(roleKey)) return;

    const h = await headers();
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        db,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });

    let userId: string | undefined;
    try {
        const res = (await auth.api.signUpEmail({ body: { email, password, name: email.split("@")[0] ?? email } })) as {
            user?: { id?: string };
            id?: string;
        };
        userId = res?.user?.id ?? res?.id;
    } catch {
        return; // 邮箱已存在等 → 不覆盖既有账号
    }
    if (userId) await assignRole(db, { subjectId: userId, roleKey });
    revalidatePath("/team");
}

/** 给成员追加一个后台角色。 */
export async function assignRoleAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.roleManage);
    const subjectId = String(formData.get("subjectId") ?? "");
    const roleKey = String(formData.get("roleKey") ?? "");
    if (!subjectId || !isBackendRole(roleKey)) return;
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    await assignRole(db, { subjectId, roleKey });
    revalidatePath("/team");
}

/** 移除成员某后台角色。保护：不允许移除最后一个 super_admin（防团队管理自锁）。 */
export async function revokeRoleAction(formData: FormData): Promise<void> {
    const { env } = await requirePermission(PERMISSIONS.roleManage);
    const subjectId = String(formData.get("subjectId") ?? "");
    const roleKey = String(formData.get("roleKey") ?? "");
    if (!subjectId || !isBackendRole(roleKey)) return;

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    if (roleKey === "super_admin") {
        const members = await listAdminMembers(db);
        const saCount = members.filter((m) => m.roles.includes("super_admin")).length;
        if (saCount <= 1) return; // 最后一个超管，拒绝
    }
    await revokeRole(db, { subjectId, roleKey });
    revalidatePath("/team");
}
