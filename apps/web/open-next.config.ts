import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

// ISR（方案 B）两级缓存：
// - 持久层：R2 增量缓存（成品页存 NEXT_INC_CACHE_R2_BUCKET）——B-1。
// - 区域快层：withRegionalCache 用 Cloudflare Cache API 就近缓存（short-lived：同区最多复用 ~1 分钟），
//   命中就不读 R2；未命中自动退到 R2（= B 的水平）。不改失效模型（仍 60s 时间型），纯加速。
// - queue：DO Queue 去重/调度后台 revalidate（NEXT_CACHE_DO_QUEUE / DOQueueHandler）。
// B 只用时间 revalidate，故不配 tagCache（那是方案 A 的 revalidateTag 才需要）。
export default defineCloudflareConfig({
    incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "short-lived" }),
    queue: doQueue,
});
