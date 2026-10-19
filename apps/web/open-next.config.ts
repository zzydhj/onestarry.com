import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

// ISR（方案 B：时间型 revalidate）两级缓存的第一级：
// - incrementalCache：成品页存 R2（绑定 NEXT_INC_CACHE_R2_BUCKET，前缀默认 incremental-cache/）
// - queue：Durable Object Queue 去重/调度后台 revalidate（绑定 NEXT_CACHE_DO_QUEUE / DOQueueHandler）
// B 只用时间 revalidate，故不配 tagCache（那是方案 A 的 revalidateTag 才需要）。
// B-2 再用 withRegionalCache(...) 叠加 Cache API 区域快层，形成"区域快层 + R2 持久层"两级。
export default defineCloudflareConfig({
    incrementalCache: r2IncrementalCache,
    queue: doQueue,
});
