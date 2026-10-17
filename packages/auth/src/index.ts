import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb, customerAuthSchema, adminAuthSchema } from "@onestarry/db";

/**
 * Better Auth 双实例工厂（Workers 友好）。
 * Workers 无常驻模块级 db：每次请求用 env.HYPERDRIVE.connectionString 构造实例。
 * customer 与 admin 为两套隔离实例（独立表前缀 + 独立 cookie 域/名称）。
 */
export interface AuthEnvConfig {
    connString: string; // env.HYPERDRIVE.connectionString
    baseURL: string; // 站点 origin
    secret: string; // BETTER_AUTH_SECRET
}

export function createCustomerAuth({ connString, baseURL, secret }: AuthEnvConfig) {
    const db = createDb(connString);
    return betterAuth({
        appName: "onestarry",
        baseURL,
        secret,
        database: drizzleAdapter(db, { provider: "pg", schema: customerAuthSchema }),
        emailAndPassword: { enabled: true },
    });
}

export function createAdminAuth({ connString, baseURL, secret }: AuthEnvConfig) {
    const db = createDb(connString);
    return betterAuth({
        appName: "onestarry-admin",
        baseURL,
        secret,
        database: drizzleAdapter(db, { provider: "pg", schema: adminAuthSchema }),
        emailAndPassword: { enabled: true },
    });
}

export type CustomerAuth = ReturnType<typeof createCustomerAuth>;
export type AdminAuth = ReturnType<typeof createAdminAuth>;
