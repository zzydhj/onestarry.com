import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// ISR 缓存三个部件：持久层 R2（成品页存 NEXT_INC_CACHE_R2_BUCKET）+ DO Queue 调度后台刷新
// + D1 Tag Cache 让按需失效真能落地。
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
// 【2026-10-25 更正：原先最后一行写的是「本站只用时间 revalidate，故不配 tagCache」，那句判断错了】
// 按需失效通道（POST /api/internal/invalidate）用的正是 revalidatePath，而它属于 on-demand revalidation，
// 按 OpenNext 的模型必须有 Tag Cache 才落地。缺它时 D1NextModeTagCache.getConfig() 直接判 isDisabled，
// hasBeenRevalidated() 恒返回 false → 于是 docs/PERF.md §7 那条「构建期上传的条目对 revalidatePath 免疫」
// 并不是 Next 的怪病，而是我们少装了官方「小站配方」（R2 + DO Queue + D1NextModeTagCache）的第三件。
// 建表脚本见 apps/web/d1/revalidations.sql（约束形状已用 D1 实测钉死，不是照抄文档）。
// 副作用：每次读页多一次 D1 查询；代码内有请求级内存去重（#resolveTagValues 的 itemsCache）。
// 回退：删掉下面 tagCache 一行与 wrangler.jsonc 的 d1_databases 块 → 退回本轮之前的行为（fail-open，不会更坏）。
export default defineCloudflareConfig({
    incrementalCache: r2IncrementalCache,
    queue: doQueue,
    tagCache: d1NextTagCache,
});
