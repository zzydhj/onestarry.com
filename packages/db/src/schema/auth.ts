/**
 * schema/auth.ts —— Better Auth 表（双实例：customer_* / admin_*）
 * 两套隔离实例：独立表前缀 + 独立 cookie 域（见 §3.7 / §7）。
 * 列结构遵循 Better Auth 官方 schema（user/session/account/verification）。
 * 运行时工厂（按 Workers 请求从 env.HYPERDRIVE 构造 betterAuth 实例）在 packages/auth（下一步）。
 */
import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** 生成一套 Better Auth 表（按前缀）。 */
function makeAuthTables(prefix: string) {
    const user = pgTable(`${prefix}_user`, {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        email: text("email").notNull().unique(),
        emailVerified: boolean("email_verified").notNull().default(false),
        image: text("image"),
        createdAt: ts("created_at"),
        updatedAt: ts("updated_at"),
    });

    const session = pgTable(
        `${prefix}_session`,
        {
            id: text("id").primaryKey(),
            expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
            token: text("token").notNull().unique(),
            createdAt: ts("created_at"),
            updatedAt: ts("updated_at"),
            ipAddress: text("ip_address"),
            userAgent: text("user_agent"),
            userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        },
        (t) => [index(`${prefix}_session_user_idx`).on(t.userId)],
    );

    const account = pgTable(
        `${prefix}_account`,
        {
            id: text("id").primaryKey(),
            accountId: text("account_id").notNull(),
            providerId: text("provider_id").notNull(),
            password: text("password"),
            userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
            accessToken: text("access_token"),
            refreshToken: text("refresh_token"),
            idToken: text("id_token"),
            accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
            refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
            scope: text("scope"),
            createdAt: ts("created_at"),
            updatedAt: ts("updated_at"),
        },
        (t) => [index(`${prefix}_account_user_idx`).on(t.userId)],
    );

    const verification = pgTable(`${prefix}_verification`, {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull(),
        value: text("value").notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
        createdAt: ts("created_at"),
        updatedAt: ts("updated_at"),
    });

    return { user, session, account, verification };
}

const customer = makeAuthTables("customer");
export const customerUser = customer.user;
export const customerSession = customer.session;
export const customerAccount = customer.account;
export const customerVerification = customer.verification;

const admin = makeAuthTables("admin");
export const adminUser = admin.user;
export const adminSession = admin.session;
export const adminAccount = admin.account;
export const adminVerification = admin.verification;

/** 供 packages/auth 的 drizzleAdapter 使用的两套 schema 映射。 */
export const customerAuthSchema = {
    user: customerUser,
    session: customerSession,
    account: customerAccount,
    verification: customerVerification,
};
export const adminAuthSchema = {
    user: adminUser,
    session: adminSession,
    account: adminAccount,
    verification: adminVerification,
};
