import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

// ISR 缓存：持久层 R2（成品页存 NEXT_INC_CACHE_R2_BUCKET）+ DO Queue 调度后台刷新。
//
// 【2026-10-22 回退：这里原先还包了一层 withRegionalCache(..., { mode: "short-lived" }) 作「B-2 提速」，已彻底移除】
// 线上取证结论（完整过程见 docs/PERF.md）：
//   症状 = /products/[slug] 全部商品页恒 STALE、且响应连 Cache-Control 都没有，每个访客都回源全额渲染；
//         同一 colo 内逐请求 HIT/STALE 精确交替，60s 新鲜窗口塌成 ~10s。
//   根因 = 该层的 set() 用 Date.now() 给条目打 lastModified，而 Workers 出于安全模型把隔离体内的
//         Date.now() 钉在「最后一次 IO 的时刻」（regional-cache.js 自己的注释就写了这点）；
//         get() 命中区域副本时又直接返回旧副本、只在 waitUntil 里后台刷新，
//         且 short-lived 模式固定按 max-age=60 存副本、完全不看条目自身的 revalidate。
//         于是「这个条目多旧」同时有两套真值：R2 的 object.uploaded（准）和隔离体时钟（钉住），二者互相打脸。
//   判据 = 只有运行时 set() 写出来的条目坏（5 个商品页）；由 CI 构建期 populate-cache 上传、
//         从不经手 set() 的 / 与 /products 全程健康 —— 分组干净，嫌疑只剩这一层。
//   收益 = 该层按上游注释的真正价值是「命中时绕过 tag cache」，而本站未配 tagCache（解析成 dummy）、
//         且 enableCacheInterception 默认 false（那条快路径整条未跑）→ 对本站零收益，只多一套时钟。
// 因此回到「R2 单一真值源」：条目年龄只由 object.uploaded 决定，不再有第二个时钟来源。
//
// 【2026-10-25：试过配 D1NextModeTagCache，已上线并回退——不要装回去，除非先解决下面这个坏形状】
// 当时的理由成立：官方三件套里 Tag Cache 专管 revalidatePath/revalidateTag，缺它时
// D1NextModeTagCache.getConfig() 判 isDisabled、hasBeenRevalidated() 恒 false → 按需失效是静默空动作
// （就是 §7 那条“预渲染条目免疫”的根因）。但装上后线上现场实测到更坏的行为：
//   后台一次保存写入标记（revalidatedAt=now）后，/、/products、PDP **持续恒 STALE + s-maxage=2 至少 25 分钟**，
//   探针报 never_hits / badStreak 18；把这些标记行删掉，当场恢复 HIT + s-maxage=58。
//   即“标记永不被本次重渲染清除”——按需失效变成按需永久失效，且只在有人保存时发作。
// 机制未定论（为何写回不推进条目 lastModified），但不得先把线上留在会静默塌陷的配置上。
// 要重做“预渲染条目也能秒级失效”，走另一条路：失效时直接删 R2 条目（NEXT_INC_CACHE_R2_BUCKET 已绑），
// 不要靠 tag 标记。取证过程与数字见 docs/PERF.md §7。
export default defineCloudflareConfig({
    incrementalCache: r2IncrementalCache,
    queue: doQueue,
});
