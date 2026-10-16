import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// 加载仓库根的 .env.local（neon env pull 写入处）；已存在的环境变量优先
config({ path: "../../.env.local" });

export default defineConfig({
    schema: "./src/schema/index.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        // 迁移期用直连（非池化）URL；运行时用 Hyperdrive / 池化 URL
        url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
    },
    // 严格模式：迁移生成前需确认，避免误删列/表
    verbose: true,
    strict: true,
});
