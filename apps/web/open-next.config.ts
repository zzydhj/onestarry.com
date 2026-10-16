import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 先用默认配置跑通 hello world；ISR 两级缓存（R2 incremental cache + Durable Object queue）在步骤 2 验证后再接。
export default defineCloudflareConfig();
