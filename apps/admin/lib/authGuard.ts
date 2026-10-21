/**
 * authGuard.ts —— 后台 Better Auth **HTTP 面**的策略闸门（纯函数，可单测、不依赖 next/workers）。
 *
 * 为什么拦 HTTP 而不是改 better-auth 配置：
 * better-auth 的 `emailAndPassword.disableSignUp` 会把**进程内** `auth.api.signUpEmail` 一起拒掉，
 * 而「团队页建员工」(createStaffAction) 与 `seed-admin` 正是进程内调用 → 后台就没法发账号了。
 * 因此这里只封公开的 catch-all 路由：外部任何人无法自助注册后台账号；
 * 建号唯一入口 = 已登录 super_admin 经「团队」页（`requirePermission(roleManage)`）或 seed 脚本。
 */
export function isBlockedPublicAuthPath(pathname: string): boolean {
    return pathname.includes("/sign-up");
}
