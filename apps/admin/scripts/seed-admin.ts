/**
 * seed-admin.ts —— 创建/提升第一个后台超级管理员（super_admin）。
 * admin 实例不开放公开注册，用此脚本落地初始管理员。
 *
 * 用法（PowerShell）：
 *   $env:SEED_ADMIN_EMAIL="you@example.com"; $env:SEED_ADMIN_PASSWORD="至少8位强密码"; pnpm --filter @onestarry/admin seed:admin
 * 读 .env.local 的 DATABASE_URL_UNPOOLED。可重复执行（幂等：已存在则确保角色）。
 */
import { config } from "dotenv";
config({ path: "../../.env.local" });

import { eq } from "drizzle-orm";
import { createDb, roles, principalRoles } from "@onestarry/db";
import { createAdminAuth } from "@onestarry/auth";

async function main() {
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("DATABASE_URL_UNPOOLED 未设置（检查 .env.local）");

    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
        throw new Error("请设置环境变量 SEED_ADMIN_EMAIL 和 SEED_ADMIN_PASSWORD（不要写进代码库）");
    }

    const db = createDb(url);
    const auth = createAdminAuth({
        connString: url,
        baseURL: "http://localhost:3000",
        secret: process.env.SEED_BETTER_AUTH_SECRET ?? "seed-local-secret-not-for-prod",
    });

    // 1) 建管理员用户（Better Auth 负责密码哈希）；已存在则登录取回 id
    let userId: string | undefined;
    try {
        const res = (await auth.api.signUpEmail({ body: { email, password, name: "Root Admin" } })) as {
            user?: { id?: string };
            id?: string;
        };
        userId = res?.user?.id ?? res?.id;
        console.log(`已创建管理员用户 ${email}`);
    } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (/exist|already/i.test(msg)) {
            const s = (await auth.api.signInEmail({ body: { email, password } })) as {
                user?: { id?: string };
            };
            userId = s?.user?.id;
            console.log(`管理员 ${email} 已存在，复用其 id`);
        } else {
            throw e;
        }
    }
    if (!userId) throw new Error("无法获取管理员 userId");

    // 2) 确保内置 super_admin 角色存在
    let role = (await db.select().from(roles).where(eq(roles.key, "super_admin")).limit(1))[0];
    if (!role) {
        role = (await db.insert(roles).values({ key: "super_admin", name: "Super Admin", isSystem: true }).returning())[0];
        console.log("已创建 super_admin 角色");
    }

    // 3) 绑定主体→角色（admin kind）
    await db
        .insert(principalRoles)
        .values({ subjectId: userId, kind: "admin", roleId: role!.id })
        .onConflictDoNothing();

    console.log(`✅ 完成：${email} 现为 super_admin（用此邮箱/密码登录后台 /signin）`);
    process.exit(0);
}

main().catch((e) => {
    console.error("❌ seed-admin 失败：", e);
    process.exit(1);
});
