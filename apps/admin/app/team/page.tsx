import { PERMISSIONS } from "@onestarry/core";
import { createDb, listAdminMembers } from "@onestarry/db";
import { requirePermission } from "@/lib/auth";
import { Button } from "@onestarry/ui";
import { assignRoleAction, createStaffAction, revokeRoleAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
    super_admin: "超级管理员",
    staff: "员工",
    customer: "客户",
};

/** 团队管理（super_admin 专属，需 role:manage）：新建员工 + 分配/移除后台角色。 */
export default async function TeamPage() {
    const { env } = await requirePermission(PERMISSIONS.roleManage);
    const db = createDb(env.HYPERDRIVE.connectionString);
    const members = await listAdminMembers(db);

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-2xl font-semibold tracking-tight text-brand">团队管理</h1>
            <p className="mt-1 text-sm text-muted">新建后台账号并分配角色。员工(staff)可管商品/订单/类目/SEO；退款/市场/团队/系统配置仅超级管理员。</p>

            {/* 新建员工 */}
            <form action={createStaffAction} className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-4">
                <input
                    type="email"
                    name="email"
                    placeholder="员工邮箱"
                    required
                    className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <input
                    type="password"
                    name="password"
                    placeholder="初始密码(≥8位)"
                    required
                    minLength={8}
                    className="w-40 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <select name="roleKey" defaultValue="staff" className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent">
                    <option value="staff">员工</option>
                    <option value="super_admin">超级管理员</option>
                </select>
                <Button type="submit">新建</Button>
            </form>

            {/* 成员列表 */}
            <div className="mt-6 overflow-hidden rounded-xl border border-line">
                <table className="w-full text-sm">
                    <thead className="bg-white text-left text-muted">
                        <tr>
                            <th className="px-4 py-2 font-medium">账号</th>
                            <th className="px-4 py-2 font-medium">当前角色</th>
                            <th className="px-4 py-2 font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {members.map((m) => (
                            <tr key={m.userId} className="border-t border-line">
                                <td className="px-4 py-3">
                                    <div className="text-brand">{m.email}</div>
                                    {m.name && <div className="text-xs text-muted">{m.name}</div>}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1">
                                        {m.roles.length === 0 ? (
                                            <span className="text-xs text-muted">（无）</span>
                                        ) : (
                                            m.roles.map((r) => (
                                                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-line">
                                                    {ROLE_LABELS[r] ?? r}
                                                    <form action={revokeRoleAction} className="inline">
                                                        <input type="hidden" name="subjectId" value={m.userId} />
                                                        <input type="hidden" name="roleKey" value={r} />
                                                        <button type="submit" className="text-muted transition hover:text-red-600" title="移除该角色">
                                                            ×
                                                        </button>
                                                    </form>
                                                </span>
                                            ))
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <form action={assignRoleAction} className="flex items-center gap-2">
                                        <input type="hidden" name="subjectId" value={m.userId} />
                                        <select name="roleKey" defaultValue="staff" className="rounded-lg border border-line px-2 py-1 text-sm outline-none focus:border-accent">
                                            <option value="staff">员工</option>
                                            <option value="super_admin">超级管理员</option>
                                        </select>
                                        <Button type="submit" variant="secondary" size="sm">
                                            分配
                                        </Button>
                                    </form>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </main>
    );
}
