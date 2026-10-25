import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, customerAuthSchema, adminAuthSchema, type Db } from "@onestarry/db";
import { SITE_NAME } from "@onestarry/core";

/**
 * Better Auth 双实例工厂（Workers 友好）。
 * Workers 无常驻模块级 db：每次请求构造实例（不跳请求复用，原因见 packages/db/src/client.ts）。
 * customer 与 admin 为两套隔离实例（独立表前缀 + 独立 cookie 域/名称）。
 */
export interface AuthEnvConfig {
    connString: string; // env.HYPERDRIVE.connectionString（未注入 db 时才用它建客户端）
    baseURL: string; // 站点 origin
    secret: string; // BETTER_AUTH_SECRET
    /**
     * 可选：注入已经建好的客户端。
     *
     * 为什么需要：一次后台页面渲染原先要建 **3 条**数据库连接（这里一条 + 守卫查权限一条
     * + 页面自己一条），而一条新 postgres 连接是 4–6 次跨洋往返（TCP/TLS/SCRAM/参数协商），
     * 实测占掉 1.8–2.2 秒（取证见 docs/PERF.md §2 第⑩行与 apps/admin/lib/db.ts 顶部）。
     * 调用方传 `getRequestDb(...)` 的结果进来，同一次请求就只有一连接。
     * 不传则保持旧行为（自带一条），所以现有调用点不会因本参数而改变。
     */
    db?: Db;
}

/**
 * 限流与 IP 取头（两套实例共用，差异只在登录频次）。
 *
 * ⚠️ 三个必须知道的边界：
 * 1. `storage: "memory"` → 计数存在 isolate 内存。Workers 无常驻进程，所以这是
 *    **每 isolate 一份**的软限制（能拦住集中试密码，但不是全局硬保证）。要硬防刷
 *    应在 Cloudflare 层加 WAF rate-limiting 规则（Dashboard 配，见 REBRAND 运维清单）。
 *    没选 `storage: "database"`：那会给**每次**鉴权请求多一次跨洋往返（现测 RTT 150–250ms），
 *    且需为两套表前缀各建一张 rateLimit 表 + 过期清理 —— 性价比不成立。
 * 2. Better Auth 默认**只在 production 生效**，这里显式 `enabled: true`，保证 dev 与 prod 同行为。
 * 3. IP 必须从 `cf-connecting-ip` 取（Cloudflare 写入的真实客户端 IP，客户端不可伪造）；
 *    取错会退化成“全站共享一个计数”→ 直接变成自己 DoS 自己。
 */
function buildRateLimit(signInMaxPerMinute: number) {
    return {
        enabled: true,
        // 全局默认：每 10 秒 30 次（覆盖会话刷新等正常高频调用，不误伤普通用户）
        window: 10,
        max: 30,
        storage: "memory" as const,
        customRules: {
            "/sign-in/email": { window: 60, max: signInMaxPerMinute },
            "/sign-up/email": { window: 3600, max: 5 },
            "/forget-password": { window: 3600, max: 5 },
            "/reset-password": { window: 600, max: 10 },
            "/change-password": { window: 600, max: 5 },
            "/email-otp": { window: 3600, max: 10 },
        },
    };
}

const ADVANCED = {
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
};

export function createCustomerAuth({ connString, baseURL, secret, db: injected }: AuthEnvConfig) {
    const db = injected ?? createDb(connString);
    return betterAuth({
        // appName 会出现在重置密码邮件等对外文案里 → 跟着品牌走，不写字面量
        appName: SITE_NAME,
        baseURL,
        secret,
        database: drizzleAdapter(db, { provider: "pg", schema: customerAuthSchema }),
        emailAndPassword: { enabled: true },
        rateLimit: buildRateLimit(8),
        advanced: ADVANCED,
    });
}

export function createAdminAuth({ connString, baseURL, secret, db: injected }: AuthEnvConfig) {
    const db = injected ?? createDb(connString);
    return betterAuth({
        appName: `${SITE_NAME}-admin`,
        baseURL,
        secret,
        database: drizzleAdapter(db, { provider: "pg", schema: adminAuthSchema }),
        emailAndPassword: { enabled: true },
        // 后台面窄且只有员工，登录频次给得更紧
        rateLimit: buildRateLimit(5),
        advanced: ADVANCED,
    });
}

export type CustomerAuth = ReturnType<typeof createCustomerAuth>;
export type AdminAuth = ReturnType<typeof createAdminAuth>;
