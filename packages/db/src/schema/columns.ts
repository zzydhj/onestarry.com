import { uuid, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "../uuid7";

/** 全表共享：UUIDv7 主键 + created/updated 时间戳。 */
export const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());

export const timestamps = () => ({
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
