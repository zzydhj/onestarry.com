# PERF — 延迟预算、实测数据与缓存判读法

本文件是**唯一**的性能结论来源。规则只有一条：**没有实测数字就别写结论，也别改代码**。
所有数字下面都附了复现命令，怀疑结论时先重跑，不要靠推理翻案。

---

## 1. 为什么这个站慢：一切开销都是 RTT

数据层是 Neon Postgres（`us-east-2`），计算层是 Cloudflare Workers（全球边缘）。
一次查询的成本 = 计算（几乎免费）+ **一次跨洋往返**（~450–500ms，本地直连实测）。
所以「优化」在本项目里几乎等价于「**减少往返次数**」，而不是「让 SQL 更快」。

线上基线（`curl` 打 TTFB，HK 出口）：

| 页面 | 查询数 | TTFB |
| --- | --- | --- |
| `/api/health`（0 查询） | 0 | 0.69–0.84s |
| `/api/db-check` | 2 | 1.4–2.9s |
| `/products`（列表） | 4 | 2.65–5.29s |

**每多一条串行查询 ≈ +0.4–0.9s**。这是所有读路径改动的定价依据。

---

## 2. 手法有效性（`pnpm --filter @onestarry/db perf:probe`，本地直连 Neon）

| 编号 | 测什么 | 结果 | 结论 |
| --- | --- | --- | --- |
| ① | 每请求新建 client 的首条查询 | 冷 3.5–9.6s / 热后 ~0.5s | 握手是大头；线上走 Hyperdrive 池化，**本地数字不能直接套线上** |
| ② | `max:1` 单连接上 `Promise.all` 5 条 | 与串行同量级 | 单连接会把查询排成队 |
| ③ | `max:3` 多连接 `Promise.all` 5 条 | 263ms | 多连接确实并发，但要额外握手 |
| ④ | 后台订单详情：5 条串行 vs 合成 1 条 `json_agg` | **2421ms → 258ms** | 合并一条是量级差异 |
| ⑥ | 真实三表读（**同一 `max:1` 连接**）：串行 / 并行 / 合并 | 1511 / 1531 / **502**ms | **同一连接内并行零收益**（差 -20ms，噪声内）；只有合并有效 |
| ⑧ | 两条查询在**两个独立 client**（各 `max:1`）：串行 / 并行 | 975 → **510**ms/轮 | **跨连接并行有收益**（省一个 RTT ≈ 465ms） |
| ⑦ | 下单写路径 `createOrder`（事务内跑完 ROLLBACK） | **874ms**（旧 7 条串行 = 4386ms） | 合成单条 data-modifying CTE + 摘掉外层事务 |
| ⑨ | 类目页取数：5 次串行 vs 1 条聚合 + 1 条列表（本地直连 Neon，`smoke:catalog-page` 逐字段对照） | **2256–4640ms → 999–1280ms**（聚合那一条单独 ~500ms） | 同上——只有合并有效；见 `queries/catalogPage.ts` |
| ⑩ | 后台**商品详情**取数：8 次串行 vs 1 条聚合（本地直连 Neon，`smoke:admin-detail` 逐字段对照，5 个商品各 3 轮取中位） | 每商品 **4.4–5.3s → 0.53–0.65s**；5 商品合计 **23288ms → 2933ms（7.9x）** | 同一手法第二次生效，这次打在**后台**（用户报“从列表点进详情要 6 秒”）；绝对值含 CN→US 直连 RTT，不能当线上时长，结构收益是“往返 8→1”；见 `queries/adminProductDetail.ts` |

### 由此得出的三条硬规矩

1. **同一个 `db` 实例里的多条查询，别用 `Promise.all` 骗自己** —— `max:1` 会把它们排队。要提速就合成一条 SQL（`json_build_object` / `count(*) over ()` / 相关子查询）。
2. **`Promise.all` 只在两个独立连接之间有效** —— 典型例子是结账 action：会话走 better-auth 自己的 client、市场查找走请求内 `db`，这是两个连接，并行确实省一个 RTT。判断标准是「这两次读是不是各自的 client」。
3. **写路径优先合成单条语句** —— 一条语句天然原子，`db.transaction()` 在外层只是多加 `BEGIN`/`COMMIT` **两次跨洋往返**。幂等/金额口径要留在 SQL 的门控里（见 `queries/orders.ts` 的 CTE 写法）。

### postgres-js / drizzle 合并查询时会咬人的四处（都踩过）

- 裸 `select` 出来的 `bigint` 是 **string**，但同一列被塞进 `json_build_object` 后变成 **number**。跨这两种形态别假设类型一致。
- 列别名默认走 `casing: "snake_case"`；**驼峰别名会原样保留**（`itemsJson` 存在、`itemsjson` 不存在）。混用会让前端拿到意外的小写键。
- `Date` 对象不能直接进裸 `sql` 模板（`ERR_INVALID_ARG_TYPE`）→ 传 `sql\`${v.toISOString()}::timestamptz\``。
- 枚举列不吃 `::text` 参数，必须写 `'shipping'::address_type` 这样的字面量；同名字段在多表 join 的 `select` 里要写全限定名 `"orders"."id"`，否则 `42702 column "id" is ambiguous`。
- **`to_jsonb(整行)` 返回的是真实列名（`seo_title`），drizzle 的行映射不会替我们做**。把它直接交给读 camelCase 的代码（`applySeoMeta`）= SEO 覆盖静默失效：typecheck 过、页面不报错、看不出来。要 camelCase 就逐字段 `json_build_object('seoTitle', m.seo_title, ...)` 写出来，并在冒烟里事务造一行断言（`smoke:catalog-page`）。

---

## 3. 边缘缓存（ISR）—— 2026-10-22 事故复盘

### 症状

5 个商品详情页（`/products/[slug]`）**恒定 `x-nextjs-cache: STALE`、且响应完全没有 `Cache-Control`**；
首页与列表页退化成「STALE + `s-maxage=2`」。用户侧的表现是：读页每次回源、每次付全额数据库成本。

### 三个「看起来像故障其实不是」的判读陷阱

1. **`s-maxage` 在 HIT 时是剩余新鲜度倒计时**（`revalidate - 条目已存在秒数`，`@opennextjs/aws` `core/routing/util.js:338-347`）。
   刚刷完才接近满值，之后逐秒递减。**「60 变成 47」不是回归**，是同一个副本在变老。
2. **STALE 被改写成 `s-maxage=2, stale-while-revalidate=2592000` 是设计**（同文件 349-355），不是配置被破坏。
3. **低频访问（间隔 > `revalidate`）必然每次撞 STALE**，这也正常。判健康要看**状态翻转**，不是看单次值。

> 复现：`powershell -File scripts/isr-watch.ps1 -Rounds 5 -GapSeconds 15`
> 健康形状：`STALE(2) → HIT(47) → HIT(31) → HIT(15) → STALE`。

### 真故障形状与定位过程

只有 `/products/[slug]` 一条路由族坏，而同站 `/`、`/products` 正常翻转。排除法：

| 试验 | 观察 | 排除的假设 |
| --- | --- | --- |
| `wrangler tail` | 每次 GET 后都有 `HEAD …Ok` + `DOQueueHandler.revalidate …Ok` | 后台刷新没触发 / DO 挂了 |
| R2 列举 + 单变量打流量 | PDP 每次都改写到**同一个 key**（键稳定），对象数不增 | 每次请求生成新键 |
| 拉条目实体对比 | PDP 与 `/` 的条目结构完全一致：`{type,html,rsc,meta,revalidate:60,…}` | 条目内容/revalidate 被写坏 |
| **删掉该条目再看** | `MISS → 8s 后 HIT(s-maxage=51，倒计时精确) → 8s 后 STALE` | 读写不同键、R2 不可用 |
| 3 秒一发连打 22 次 | **HIT/STALE 逐请求 1:1 振荡**；cf-ray 20 次全在同一 colo | 多区域副本不一致 |

分组规律是关键判据：**只有「运行时 `set()` 写出来的条目」坏**（5 个 PDP），
**「CI 构建期 `populate-cache` 上传的条目」全程健康**（`/`、`/products`、blog、brands、categories、signin）。
两条路径唯一的差别就是 `withRegionalCache(..., {mode:"short-lived"})` 这一层。

### 根因

`@opennextjs/cloudflare` 的区域缓存层给条目引入了**第二个「年龄」真值**：

- `set()` 用 `Date.now()` 打 `lastModified`，而 Workers 出于安全模型把隔离体内的 `Date.now()` 钉在「最后一次 IO 的时刻」（该文件自己的注释写明）；
- `get()` 命中区域副本时**直接返回旧副本**，只在 `waitUntil` 里后台刷新；
- `short-lived` 模式固定按 `max-age=60` 存副本，**完全不看条目自身的 `revalidate`**；
- 而 R2 层的 `lastModified` 来自 `object.uploaded`（服务器时间，准）。

两套时钟对同一个条目各说各话 → 表现为逐请求振荡、60s 窗口塌成 ~10s。
顺带解释了「为什么没有 `Cache-Control`」：`fixISRHeaders` 开头就是「原头里没有 `s-maxage` 就直接 return」，
而补 `s-maxage` 的 `fixCacheHeaderForHtmlPages` 只覆盖构建期预渲染页面清单 —— 按需 ISR 的 PDP 不在里面。
**没有 `Cache-Control` = CDN 一份都不留 = 每个访客都回源。**

补充事实：本站 `defineCloudflareConfig` 从未开启 `enableCacheInterception`（默认 `false`），
也没配 `tagCache`（解析成 `dummy`）—— 而区域缓存层的真正卖点按上游注释是「命中时绕过 tag cache」。
**即：那一层对本站的收益是 0，代价是 1 套多余的时钟。** 说不出「消灭了哪类 bug」的抽象就是白担的风险。

### 处置

1. **拆掉 `withRegionalCache`**，回到 R2 单一真值源（`apps/web/open-next.config.ts`，含完整注释）。
2. **PDP 改构建期枚举在售 slug 预渲染**（`generateStaticParams`），让它走与 `/` 相同的、已被证明健康的路径；
   连库失败退化为空列表而不是让构建变红。上限 200 个 slug，超出部分仍按需首渲染。
3. **加常驻探针**（见下节）：这条链路坏掉时不报错，任何一层都产不出「本该命中却没命中」的信号，只能外部主动测。

---

## 4. ISR 健康探针（为什么存在 + 怎么用）

`apps/jobs` 每 5 分钟（cron `*/5 * * * *`）跑一轮 `runIsrProbe`：

1. 每个路径先打一发**触发刷新**（这一发不参与判定）；
2. 等 30s 让「入队 → DO 刷新 → 写回 R2」落地（最后一发复查会被自动夹在 `revalidate` 窗口内）；
3. 复查两发（间隔 8s）—— **HIT 之前的 STALE 不算病**，只有「从不 HIT」或「HIT 之后退回非 HIT」才算。

判定结论（纯函数在 `packages/core/src/isr.ts`，有单测）：

| verdict | 含义 | 颜色 |
| --- | --- | --- |
| `ok` | 出现过 HIT，且之后没退回非 HIT | 绿 |
| `oscillating` | HIT 之后又出现非 HIT = 刚写回的副本保不住（双时钟/被清） | 黄（连续 2 轮转红） |
| `never_hits` | 从不 HIT = 写回断了/没预渲染 | 红 |
| `not_isr` | 复查全无 `x-nextjs-cache` = 该页已不是 ISR 页（配置被改） | 红 |
| `error` | 请求失败/5xx，结论不可信 | 红 |

报告写 R2 `onestarry-isr-cache/_ops/isr-health.json`（键与类型都在 core，避免各处复制形状）。
读侧两处：`/api/health` 的 `isr` 字段（机器/监控，`null` = 探针还没跑过，**必须与 `ok` 区分**）、
后台概览页运维面板第三张卡（人看，含每路采样轨迹 `STALE→HIT(47)→HIT(35)`）。

**误报控制**：单次异常不报警，`badStreak ≥ 2` 才升红 —— 刚部署完的第一轮可能读到旧条目。

### 2026-10-22 的节奏校准（别再改回去）

探针一轮要并发暖 5 条（`/`、`/products` + `ISR_PROBE_SLUGS` 个 slug，默认 3），
刷新在 DO 队列里排队、冷 Neon 首连又要几秒。实测：

- 单条暖路径：**6 秒**就翻 HIT（`STALE → +6s HIT(53) → 45 → 34 → 21 → 3 → +60s STALE → +90s HIT(27)`，
  一条完整的健康循环，顺便印证 s-maxage 是倒计时）；
- 并发暖多条时，排在后面的 PDP 到 **+26s 仍未落地**。

旧的「复查必须全 HIT + 只等 12s」把这种慢当成坏死，连报 24 轮（≈ 2 小时）`never_hits`，
而同期站点完全健康 —— **判据依赖运气就是假警报源**。现在：settle 30s + 间隔 8s + 只把
「从不 HIT / HIT 后退回」当坏，并把最后一发夹进新鲜度窗口（revalidate 调小时自动跟着缩）。
`isr.test.ts` 里有两条用例钉住这个口径（落地慢=ok、HIT 后退回=oscillating）。

这也是「先不要把 verdict 接推送告警」的理由：探测器自己还在误报时，告警只会被关掉。

### 附带治理：陈旧构建条目清理

R2 键形如 `incremental-cache/<buildId>/<sha256>.cache`，**每次部署换新 buildId，旧条目没人删**
（2026-10-22 实测桶里积了 43 个前缀 / 571 个对象）。每日 04:20 那条 cron（与数据保留同一 tick）
跑 `pruneStaleIsrCache`，双保险防误删：该 buildId 已 2 小时无任何写入 **且** 对象本身老于 48 小时才删。

---

## 5. 乐观 UI（写路径的体感）—— 三条不能少的规矩

后台的写操作都是 `force-dynamic` 页：一次写 = 会话 + 权限 + 列表几趟跨洋往返，1–2 秒起。
这条延迟砍不掉（砍的是边缘缓存，后台不能缓存），所以用乐观 UI 把它从「等待」变成「已生效」。

1. **乐观 setter 必须在 transition 内部调**。`useOptimistic` 返回的 setter 写在 `start()` 外面时，
   React 会报 `An optimistic state update occurred outside a transition or action`，
   更关键的是这笔更新**不与本次 transition 纠缠**：服务端报错时它不一定自动回滚，
   于是「卡片消失了但其实没审核」会长期留在屏幕上。正确形状：
   `start(async () => { applyOptimistic(x); await action(form); })`。
2. **action 必须返回 `{ok}`，不能返回 void**。乐观意味着屏幕先于事实变化；
   事实没变时必须说出来并回滚（发货/新建市场这类静默失败，比慢严重得多）。
   守卫 `requirePermission` 留在 try 外面，别把 `redirect()`/`FORBIDDEN` 一起吞进返回值。
3. **手动 `start()` 调 action 时 `useFormStatus` 不会置 pending**（它只跟踪表单自己的 action），
   所以按钮的禁用/文案要由 `useTransition` 的 `pending` 显式驱动，否则人会连点两下建出两条数据。

已落这规矩的四处：购物车数量/删除、评论审核、类目新增/改名、市场新增。搜索框是另一类
（防抖 + 软导航保留旧结果），不用 `useOptimistic`。

### 读路径的对应物：路由级 `loading.tsx`

同样的体感问题在读页上叫「点了没反应」：Next 在没有 Suspense 边界时，软导航期间**继续显示旧页**，
不给任何提示。2026-10-22 用户报「从品牌/分类列表页跳到具体页很卡」，其中一半就是这个（另一半是下面两件事：
预渲染缺失 + 串行取数，已各自修掉）。

- 已挂：`/products`（+ PDP 单独一层）、`/categories`、`/brands`、`/blog`，加上原有的购物车/结账/订单四处。
- 骨架形状必须与真内容同构（`GridSkeleton` 对 `ProductGrid`），否则骨架消失时整页跳一下，比多等半秒更难看。
- 新增公开读页时顺手补一个 `loading.tsx`，成本三行；不要依赖 `prefetch` 来消除这段等待 —— 预取同样可能落在已过期的条目上。

---

## 6. CDN 边缘缓存 —— 对 Worker 站点，正确的那一层是 Workers Cache，不是 Cache Rule

### 先记这条：区域级 Cache Rule 对本站无效（实测，2026-10-22）

链路是 **Cloudflare CDN → Worker（Next）→ R2**。判“边缘到底存了没”只看两件事：`cf-cache-status` 和 TTFB。

| 测什么 | 结果 | 含义 |
| --- | --- | --- |
| 同一条 `/products`：HTML vs 它引用的 `/_next/static/chunks/*.css` | HTML **始终没有 `cf-cache-status`**；CSS **`MISS → HIT`** | 差别只在**谁产生那个响应** |
| 建了 Cache Rule（`cache: true` + 路径表达式）后的 HTML | 仍然没有 `cf-cache-status`，TTFB 0.7–2.8s 不变 | 区域缓存对 Worker 自渲染的响应无从存起 |
| `x-nextjs-cache: HIT` 时的 TTFB | 0.9–2.3s（**这个数字已作废**，见下面「净收益实测」：剥掉 TLS 后源站侧只有 0.15–0.3s） | 当时误把跨国链路的 TLS 抖当成跨洋读 R2 |
| 三条读页是否发 `Set-Cookie` | **全部不发**（GDPR 同意 cookie 是 `document.cookie` 写的） | 边缘缓存不会把 A 的 cookie 回给 B |
| 按国家/IP 分流 | `CF-IPCountry` / `request.geo` / `middleware` **全仓 0 处** | 内容人人同一份，可以全局缓存 |

模型上的解释：**Worker 跑在区域缓存前面**，区域缓存只能存“Worker 回源拿到的响应”；而本站 Worker 自己
渲染、根本不回源，所以那里没东西可存 —— `cache: true` 也救不了。Cloudflare 为此专门给了
**Workers Cache**（2026-08 起）：一层放在 **Worker 入口前端**的缓存，命中时 Worker 不运行。

> ⚠ **判读更新（2026-10-22 晚，开了 Workers Cache 之后）**：上表那句「HTML 始终没有 `cf-cache-status`」
> **已经不再成立** —— 现在 HTML 一直带这个头（`MISS` / `REVALIDATED` / `HIT`），因为 Workers Cache 自己会发。
> 所以 **`cf-cache-status` 不再是区分「区域层 vs Workers 层」的依据**，拿它判区域规则有没有生效会读错。
>
> 要区分只用这个办法：**拿规则自己的豁免当开关**。我们的 `onestarry-ISR-html` 里写了
> `and not http.user_agent eq "onestarry-isr-probe"`，于是同一 URL 分别用普通 UA 和探针 UA 各打一发：
> 两者都是 `REVALIDATED` → 头来自 Workers Cache，与区域规则无关 → 规则真的什么都不做（实测于 23:1x）。
> 当天那条区域 Cache Rule 已确认无效，建议在 dashboard 里直接删掉（留着只会让人以为改它能调前台缓存）。
>
> 建 Cache Rule 过程中实测到两条与计划有关的事实，别再踩：正则运算符 `matches` 在 Free 计划不开放
> （`not entitled: the use of operator Matches is not allowed, a Business plan or a WAF Advanced plan is required`，
> 而且**只在点保存/部署时才报**）；要“恰好一段”就用 `wildcard "X/*" and not wildcard "X/*/*"`。
> 另外 `wrangler login` 的 OAuth token 只有 `zone:read`，rulesets / phase 入口都是 403 —— 区域配置写不了。

> 历史上那层 `withRegionalCache` **不是** CDN 缓存 HTML：它是 Worker 用 Cloudflare Cache API
> （`caches.default()`）在**本 colo** 给 **R2 里的 ISR 条目**做副本，缓存对象是渲染产物而不是响应。
> 它确实让 HIT 变成 0.11s，代价就是 §3 那套「两套年龄真值」。拆对了，但也顺带把唯一能藏住
> 跨洋延迟的东西拆掉了 —— 所以这一节要补的是**真正那一层**，不是把它装回去。

### 开的是 Workers Cache（配置在仓库里，不需要 zone 权限）

`apps/web/wrangler.jsonc`：`"cache": { "enabled": true }`。**回滚就是删这三行重新部署。**
存不存完全由**响应头**决定（RFC 9111），所以本站不需要路径白名单 —— 实测各路由的头本来就对：

| 路由 | `Cache-Control`（实测） | 结果 |
| --- | --- | --- |
| `/`、`/products`、PDP、`/blog`、`/brands`、`/categories` | `s-maxage=剩余新鲜度, stale-while-revalidate=2592000` | 存 ≤60s |
| `/cart`、`/checkout`、`/search`、`/order/*`、`/account/*`、`/products/<slug>/review`(307)、404 | `private, no-cache, no-store, max-age=0, must-revalidate` | BYPASS |
| `/api/*`、`/integration/*` | **原本不带任何头** → 会走启发式新鲜度 | 已在 `next.config.ts` 显式补 `no-store` |

三条让它比“区域规则”更难出事的性质：
- 带 `Set-Cookie` 的响应、带 `Authorization` 的请求都**自动 BYPASS**（加购那一发不会污染别人）。
- **缓存键默认含 Worker 版本** → 每次部署换新命名空间；`/signin` 那种 `s-maxage=31536000` 的全静态页不会“旧页发一年”。
  旁证（17:27 → 17:33，中间跨一次部署）：部署前边缘与源站的 `/signin` 字节一致（len=14491），
  部署后两边同时变成新的那一份（len=14124）且边缘 `MISS` —— 与“版本进键”一致。（当初拿它当“待验风险”又去修了一轮，见下条。）
- ⚠ **别用 `next.config` 的 `headers()` 去改已有缓存语义的页**（实测，17:44–17:50）。给 `/signin` 叠
  `public, max-age=0, s-maxage=300, must-revalidate` 后，线上不是 300 也不是原来的 31536000，而是
  `x-nextjs-cache: HIT` + **恒定 `s-maxage=1`**（连打 5 发不倒数）—— 即该页被推进了 OpenNext 的 ISR 头重写路径，
  而我无法从文档推出它为何取 1。后果比原状差（边缘几乎不存、每个访客都跑 Worker），已回退。
  规矩：`headers()` 只用来给**本来不带头**的端点（`/api/*`、`/integration/*`）补 `no-store`。
- `Vary` 按 RFC **真分段**：HTML 请求不带 `RSC`/`Next-Router-State-Tree` 头、flight 请求带 → 两种表现形各存各的，
  不会互相发错（区域缓存对 `Vary` 的处理没这么细，这也是当年为什么必须靠 `?_rsc=` 在 URL 里区分）。

### 探针必须绕开它（这是唯一会静默坏掉的地方）

Workers Cache **没有 UA 豁免**，只认「响应头 + 缓存键」。所以 `packages/jobs/src/isrProbe.ts` 给每一发挂
一次性 `?probe=<nonce>-<offset>`：边缘键含完整 query string → 必然 MISS → 一定进 Worker；而 Next 的 ISR 键
只看页面**实际读取**的 searchParams（实测 `/products?market=us&page=2` 直接复用 `/products` 那份条目）
→ 仍打在同一个源站条目上。**bust 边缘、不 bust 源站**，正好是探针要的。把它改回“裸路径”的那一刻，
§4 的 verdict 就开始失真（又一个看不出来的坏法）。

### 净收益实测（2026-10-22，作废我上一轮那句「省 1–2 秒」）

用 `server = time_starttransfer − time_appconnect` 把 TLS/网络段剥掉，同一条 `/products` 各 8 发：

| 走哪条路 | 服务端耗时（中位） | 说明 |
| --- | --- | --- |
| 边缘 HIT | **0.04–0.13s** | Worker 不运行，`Server-Timing: cfWorker` 整条消失 |
| 必进 Worker（唯一 `?probe=`） | **0.15–0.30s** | 读 R2 命中 + 出响应，本来就不贵 |

**所以这层省下的是 ~0.1–0.2s 的源站功，不是 1–2s。** 上一轮我拿 0.9–2.3s 的 TTFB 当「跨洋读 R2 的代价」，
那是我自己 CN→HK 的 TLS 握手与链路抖动 —— 边缘缓存对那段**一点作用都没有**（用户照样要跑到最近的 colo）。

更要紧的一条：**本站流量下边缘基本吸不住**，因为存的时长是源站赏的：

```
14:28:09  MISS         s-maxage=22    ← 存 22 秒
14:28:40  REVALIDATED  s-maxage=2     ← 30 秒后早过了，回源
14:29:11  REVALIDATED  s-maxage=2
14:30:46  MISS         s-maxage=36
```

`revalidate = 60` + 请求稀疏 ⇒ 打过去时 R2 条目常常已经贴着过期，源站就发 `s-maxage=2`，边缘照着只存 2 秒。
密集抽样时看到的就是 `MISS → HIT(Age 1) → REVALIDATED → HIT(Age 1)` 这个循环（6 发里 4 发回到源站）。
**这不是要修的坑，是低流量下的正常形状**：源站每刷一次，边缘就能吃到接下来那一段；而“改完可见”的上界
本来就由页自己的 `revalidate` 窗口定（预渲染条目对 `revalidatePath` 免疫，§7），所以不能拿它当拉长窗口的理由。
把 `revalidate` 拉长能让边缘好看很多，但代价直接打在“改完多久可见”上，本站已拿定主意
**保持 60 秒当兜底**（见 §7 第三条），所以这点吸收率就是当前设计下的预期值。

⚠ 还有一条**压测自己会造坏形状**：我 1 秒一发连打 8 次，把探针打成 `verdict:"oscillating", badStreak:1`
（持续把条目踩进 STALE 轮换），停手 30 秒后自己回 `ok / 0`。看到 oscillating 先确认是不是有人在扫，再怀疑 ISR。

### 代价与判读变化

- **代价**：开启后连本来免费的静态资源请求与 Worker 间调用也按标准请求计费（Free 计划 10 万请求/天，本站远不到）。
- 命中时 Worker 不运行 → `Server-Timing: cfWorker;dur=…` 会消失/归零。这是“真的没进 Worker”最硬的证据，
  比总耗时可靠（跨国链路 RTT 会把 dur 那几百毫秒盖住）。
- 边缘 HIT 里带的 `x-nextjs-cache` 与 `cache-control` 都是**存进去那一份**在重放，不是这一发源站的结论 ——
  `HIT` 配 `s-maxage=2` 就是这么来的，`cf-cache-status: REVALIDATED` 才是真回源。要看源站真值走探针那条
  穿透路径（`/api/health` 的 `isr`），或自己带唯一 `?probe=` 参数。`scripts/isr-watch.ps1` 已把
  `cf-cache-status` / `age` 打进每行，缺这两列就会读错。
- `stale-while-revalidate=2592000`（30 天）**现在会被边缘当真**：源站持续重渲染失败时，边缘能照着发旧页。
  探针读的是穿透后的源站，所以这个坏法 `verdict` 抓得到；但**边缘那一份不会被 `revalidatePath` 清掉**，
  要立刻见效得在 web Worker 里调 `cache.purge()`（`cloudflare:workers`）。这是可选件，不是修复件。
- 部署即换缓存命名空间 → 每次上线有一次冷启动，5 分钟那发探针顺带预热回来（§4）。

---

## 7. 缓存失效与新鲜度：定论与本轮修复记录

- **后台改完、前台不会立即失效：已修（2026-10-22）**。当时查出来的是**双重空转**：
  ① `apps/admin/app/products/[id]/actions.ts` 里 10 处 `revalidatePath(`/products/${productId}`)` 传的是**实体 id**，
     而前台路由是 `/products/[slug]`、`resolveSlug` 只按 `slugs.slug` 精确匹配 → 那个路径本身 404
     （实测 `/products/01jabcdefghijk0000000000` → `404 + no-store`），Next 对不存在的路径既不报错也不告警；
  ② 更要命的是 `next/cache` 只作用于**当前应用**的缓存 —— admin 与 web 是两个独立 Worker，
     在 admin 里调 `revalidatePath` 根本碰不到 web 的 R2 ISR 条目。所以 `/brands`、`/categories`、`/legal`、
     `/content` 那些调用对前台同样是空动作（评论审核只刷了后台自己的列表）。
  **修形**：前台加 `POST /api/internal/invalidate`（带共享密钥、白名单只收真实前台路由、单次 ≤20 条，
  在里面同时 `revalidatePath` 清 R2 条目）；后台加 `apps/admin/lib/invalidate.ts`，把“查真 slug + 发通知”
  整条挂到 `ctx.waitUntil`（不占保存那一下的等待）。接上的动作：商品价/库/状态/图文/图片/SEO/目录归属、
  类目、品牌、法律文档、CMS 内容（含发布/撤回/删除）、评论审核。
  验收口径（实测形状，2026-10-22，**不是** `MISS`）：带密钥 POST 之后第一发（要带唯一 `?probe=` 绕边缘）
  应该是 `STALE + s-maxage=2` —— `revalidatePath` 是把条目标为过期，旧体照给、同时触发后台重渲染；
  4~5 秒后再打一发必须是 `HIT + s-maxage` 回到接近满值（实测 59）。一直停在 `HIT + 小 s-maxage` 才说明没落地。
  ⚠ 但这条口径**只在“运行时写过条目”的路由上成立**，见下面第二条的免疫结论 ——
  拿预渲染路由去套它，会得到“永远 HIT + 小 s-maxage”而被误读成通道坏了（我在这轮里就先把 15:21 那发
  当成了确证，其实那只是 60 秒定时器到点；假阳性）。
- **只有构建期预渲染的路由才真在吃 ISR：已修（2026-10-22）**。上面那条失效通道验通的同一秒，
  暴露出 `/legal/privacy` 失效后连打 6 发全 `STALE` 且**不带 `Cache-Control`**、再也没回过 HIT。
  根因就是 §3 那句“只有 CI 构建期上传的条目健康”，但当时**只给 PDP 修了**：
  `legal/[type]` 的 `generateStaticParams` 直接 `return []`，`blog/[slug]` 与根级 `[slug]` 根本没这个函数
  → 它们始终走“按需 ISR”，运行时 `set()` 写回的条目被判即时过期 → 每次访客都跨洋全额渲染，
  §6 的边缘缓存对它们也天然无效（无头可尊）。
  修法与验收：三者都补 `generateStaticParams`（legal 枚举 `LEGAL_DOC_TYPES` **全集**，不管文档当时是否存在，
  空文档预渲染成占位页、等后台填正文时由失效通道打掉）；构建路由表里必须出现 `Revalidate/Expire` 两列
  （`1h 1y`）而不是 `ƒ (Dynamic)`，线上连打必须看到 `HIT + s-maxage 倒计时`。
  ⚠ 以后**新增公开读页就要同时加 `generateStaticParams`**，否则它会静默地回到恒 STALE（不报错、内容也对）。
- **但预渲染是有代价的：构建期上传的条目对 `revalidatePath` 免疫（实测，本轮钉死；根因见本节下一条）**。
  两种条目命运刚好互补，这是本节最重要的结论：

  | 路由类型 | 缓存健康度 | 按需失效是否生效 |
  | --- | --- | --- |
  | 构建期预渲染（首页/列表/PDP/类目/品牌/法律/CMS） | ✅ `HIT + s-maxage 倒计时` | ❌ 免疫 |
  | 只走按需 ISR（无 `generateStaticParams`） | ❌ 恒 `STALE`、无 `Cache-Control` | ✅ 当场打断 |

  证据（16:29，/legal/privacy）：POST 返回 `{"ok":true,"revalidated":["/legal/privacy"]}` 后，
  连打 10 发穿透边缘的探测，`s-maxage` 从 3213 单调降到 3191，**一次 STALE 都没出现**（不是 isolate 局部抖动，
  那种会 HIT/STALE 混杂）。对照：16:10 同一条路由还没预渲染时，用户一次保存就把 `s-maxage=3214`（还剩 53 分钟）
  的窗口 4 秒内打断 —— 同一套代码、不同条目来源，结果相反。

  **所以：“改完多久可见”唯一可靠的上界是页自己的 `revalidate` 窗口**，不是这条通道。
  因此把 `/legal/[type]` 从 3600 收到 **60**（与其他公共读页统一）：留一小时就等于“运营填完隐私政策最多等一小时”，
  而它恰好是预渲染路由、失效叫不动。真要让预渲染条目也秒级失效，得在 web Worker 里直接删
  `NEXT_INC_CACHE_R2_BUCKET` 里的条目（已绑）或边缘 `cache.purge()` —— 两条都未做，属可选件。
- **免疫的真正原因不是 Next，是我们少装了一个部件（2026-10-25 定位）**。
  读 `@opennextjs/cloudflare@1.20.12` 源码：它的缓存由三个部件组成 —— Incremental Cache（成品）、
  Queue（时间到期刷新）、**Tag Cache（专管 on-demand 失效）**；官方「小站」配方即 `R2 + DO Queue + D1NextModeTagCache`，
  而本站只装了前两件（`open-next.config.ts` 原话：“B 只用时间 revalidate，故不配 tagCache”—— 那句判断错了，
  我们的失效通道用的正是 `revalidatePath`）。缺第三件时 `D1NextModeTagCache.getConfig()` 判 `isDisabled`、
  `hasBeenRevalidated()` 恒返回 `false`，且只有开了 `NEXT_PRIVATE_DEBUG_CACHE=1` 才留一行日志
  → 所以「免疫」是一个**静默的空动作**。
  ⚠ 诚实边界：这条根因解释的是「叫不动」那一半；同一轮实测里「运行时条目能被当场打断」与「tagCache 全程缺失」
  怎么共存，我没解释清楚。**这正好当验收点**：部署后若两类路由命运趋同（都叫得动），说明当时的分组只是观察偏差；
  若仍不一致，说明还有第二个变量没挖出来 —— 届时不要把本条当已完成结论。
  **已上线并已回退（2026-10-25，当天）**：装过 D1 库 `onestarry-tag-cache` + `d1_databases` 绑定 + `tagCache: d1NextTagCache`（commit `beff993`），
  并且确实工作：一次后台保存写进 6 行正确 tag（`_N_T_/products/ceramic-mug`、`_N_T_/products`、`_N_T_/`、`_N_T_/index`、
  以及该商品的类目与品牌路径），且两次保存后 `rows_total` 仍为 6、`revalidatedAt` 前进 —— 证明 `UNIQUE(tag) ON CONFLICT REPLACE`
  的约束形状是对的（裸 INSERT 不抛异常、不靠返回顺序赌最新）。
  **但它把线上打坏了**，现场取证（均为穿透边缘的 `?probe=` 请求）：

  | 时刻 | 形状 |
  | --- | --- |
  | 保存前 | `HIT + s-maxage` 正常倒数 |
  | 保存写入标记后（持续 ≥25 分钟） | `/`、`/products`、PDP **全部 `STALE + s-maxage=2`**；探针 `never_hits / badStreak 18` |
  | `DELETE FROM revalidations` 后立即 | 三条全部 `HIT + s-maxage=58/57/57`，15 秒后 `19/18/18` 正常倒数 |

  即：**标记永不被本次重渲染清除** —— “按需失效”变成“按需永久失效”，而且只在有人真去后台点保存时发作（低流量下看不出，
  边缘拿到的是 `s-maxage=2` → 不存 → 每个访客全额渲染）。机制未定论（为何写回不推进条目 `lastModified`），
  但不得把线上留在会静默塌陷的配置上，所以先回退。
  ⛔ **我当初写的是“缺 D1 时整块 fail-open，不会更坏”—— 那句保证是错的**，而且正是它让这个改动上了线；
  fail-open 只对“没绑定时”成立，**绑上之后的行为不在我的先验里**。
  **下一步不要回到 tagCache**：要“预渲染条目也秒级可见”，走“失效时直接删 R2 条目”那条路
  （`NEXT_INC_CACHE_R2_BUCKET` 已绑，键形如 `incremental-cache/<buildId>/<sha256>.cache`，`computeCacheKey` 可复刻），
  而不是靠 tag 标记。在那之前，预渲染条目的可见上界仍就是页自己的 `revalidate` 窗口（本轮没改变）。
- **公共读页的 `revalidate = 60` 保持不动（用户拍板：当兜底）**。理论上拉长到 300s 能让边缘真吸住流量
  （§6），但拉长后“改完可见”最多要等一个窗口（预渲染条目根叫不动 `revalidatePath`，边缘那一份也不受它管辖），
  除非先把真删除（R2 条目 / 边缘 `cache.purge()`）做出来。既然 60 秒已经是实际上界，不必拿可见性换边缘命中率。
- **Hyperdrive 查询缓存：结论是不开**（`caching.disabled = true`，`npx wrangler hyperdrive get <id>` 可复核）。
  官方文档写“默认开启”，所以“应该开着”很容易误推到本站 —— 但这个站是显式关掉的，而且应该继续关：
  ① 写操作不会使缓存失效，匹配上的 SELECT 最多拿到 `max_age`（默认 60s）+ SWR 15s 前的结果；
  ② 我核过 `packages/db/src/queries/*.ts`，没有 `now()`/`CURRENT_TIMESTAMP` 这类会被排除的写法（时间全在 JS 侧算好当参数传），
  所以我们的查询**真的会被缓存** —— 正好命中最危险的三类读：加购后立即读车、结账查可售库存与价格、后台写完立即要看；
  ③ 它能省的时间又正好落在**没人在等**的路径上（前台热读已由 ISR 兜住，HIT 根本不打库，STALE 是后台重渲染）。
  真要吃这点收益，文档给的正确形状是再加一个 caching **enabled** 的 Hyperdrive 配置、只给公共目录读用，
  `cart/checkout/admin/auth` 继续走现在这个没缓存的 —— 那是可选项，不是修复项。
- 探针流量本身会让被采样的页面保持「热」状态（每 5 分钟触发一次刷新）。这是副作用，也是最小成本的预热。

---

## 7.5 分层承重审计（2026-10-25，8 发稀疏采样）

目的：回答「这几层缓存里谁真的在干活，能不能收敛」。采样刻意压低频率（同一路径两发间隔 8 秒，全程 8 发），
避免 §6 那条「密集抽样自己造坏形状」。`cfEdge;dur` 取自 `Server-Timing`，TTFB 含 CN→HK 链路所以只作参考。

| 路径 | 边缘 | `x-nextjs-cache` | `s-maxage` | `cfEdge;dur` | 含义 |
| --- | --- | --- | --- | --- | --- |
| `/` | MISS | HIT | 9 | 158ms | R2 条目约 51 秒大 |
| `/?audit=1` | MISS | HIT | 1 | 101ms | 同一条目，8 秒后剩余新鲜度 9→1 ⇒ **证明唯一 query 打的就是同一个源站条目**（方法学校验通过） |
| `/products` | MISS | STALE | 2 | 122ms | 条目在，但已过窗 |
| `/products/ceramic-mug` | MISS | STALE | 2 | 150 / 98ms | 同上 |
| `/search?q=ceramic` | BYPASS | — | no-store | 50ms（TTFB 770） | 动态页，不进任何缓存 |
| `/products/zz-audit-nope-9q` | BYPASS | MISS | no-store | **1612ms** | **最干净的「没有任何缓存条目时要付多少」对照** |

### 三条结论

1. **R2 整页缓存是承重的那一层。** 命中/陈旧时服务端 ~0.1–0.15s，全额渲染要 ~1.6s（404 那条）。差的这一秒多全是跨洋打 Neon 的往返。所以「收敛层数」的方向**不是**砍 R2。
2. **Workers Cache 这一层今天 0/6 命中，而且是结构上不可能命中。** 三个原因叠在一起：
   - 源站只赏 1–9 秒新鲜度（STALE 时固定 `s-maxage=2`）；
   - 探针被**设计成故意绕开边缘**（一次性 `?probe=`，§6），所以每 5 分钟的预热只热 R2，从不热边缘；
   - 部署即换缓存命名空间（§6），上线后边缘是空的。
   ⇒ 边缘层只能由「同一新鲜窗口内的第 2+ 个真实访客」填上。本站当前自然访客≈0 ⇒ 命中率恒 0。
   **注意 §6 那句「ISR 读页 → 存 ≤60s」是上限而不是实际值**；实际值今天测出来是 0。
3. **「60 秒陈旧」这个承诺已经不成立，实际上界约等于探针周期。** 无自然流量时，条目过期后没有任何东西触发刷新，只有 5 分钟那一轮探针会刷；于是前台内容最旧可达 ~5 分钟。（另：探针一轮只暖 3 个 slug，`ISR_PROBE_SLUGS` 默认值；本站 `us` 市场有 5 个已定价变体，即有 2 个 PDP 完全不暖。）
   这修正 §7 第三条「保持 60 秒当兜底」的前提 —— 那条假设「窗口到点就有人刷」，而无流量时并不成立。
   ⛔ **本条原文有一句写错了，已改：「每一发访客请求都会各自触发一次后台重渲染」。** 重渲染是经 DO Queue 调度的，
   而官方文档明写该队列「offers support for de-duplicating requests」（默认 10 个实例 × 5 并发 = 最多 50 个并发重验证），
   所以不是「一人一发」；真正的问题只是「陈旧期间拿的是旧页 + 旧页只能存 2 秒」，不是渲染风暴。

### 由此得出的收敛建议（尚未实施，等拍板）

判据只有一条：**60 秒窗口内是否会有 ≥2 个真实访客。**

- **现在（无流量）：关掉 Workers Cache 更划算。** 收益不是那 0.1–0.2s（它根本没在生效），而是**一次性消掉四项长期复杂度**：
  ① `cf-cache-status` 两层共用一个头名的判读歧义（已导致两次误读，§6 的 ⚠ 段整段可删）；
  ② 探针必须挂一次性 query 才不被接住 —— 改回裸路径就静默失真（§6 说这是「唯一会静默坏掉的地方」，关掉后这个坏法不存在）；
  ③ 边缘那份副本不受应用内 `revalidatePath` 管辖 ⇒ 可见性上界多一个不受控变量；
  ④ 本来免费的静态资源请求开始计费、以及部署换命名空间带来的边缘冷启动。
  代价：每发都进 Worker，服务端多 ~0.1s（用户链路 RTT 远大于此，体感不可辨）。回滚 = 把 `cache.enabled` 加回那三行。
- **有流量之后再开，且开的同时必须补「真删除」**（在 web Worker 里直接删 `NEXT_INC_CACHE_R2_BUCKET` 条目 + 调 `cache.purge()`），
  否则拉长 `revalidate` 换边缘命中率会直接伤「改完可见」—— 这正是 §7 第三条当初不动 60 秒的理由。
- **无流量期更该做的是把新鲜度上界改对**：要么把探针周期与 `revalidate` 对齐（1 分钟一轮，代价是 §4 的配额与「探测器自己把页面踩热」的副作用放大），要么在文档与产品口径上把「约 5 分钟」承认为实际上界。我倾向前者，但等支付跑通再动。

### 与支付工作的交叉提醒

PDP 显示的价可能是几分钟前的，而购物车/结账一律**服务端重计价**（`queries/cart.ts` / `createOrder` 的 CTE 为准），
所以不会出现资损或错账，但会出现「详情页价 ≠ 结账价」的体感差异。**测 PayPal 时若看见价格对不上，先想到这里，别当支付 bug 查。**

## 8. 复现清单

```bash
# 手法有效性（串行/并行/合并、冷连接、下单写路径）
pnpm --filter @onestarry/db perf:probe

# 读路径与下单写入的口径冒烟（连真实库，不改数据）
pnpm --filter @onestarry/db smoke:queries
pnpm --filter @onestarry/db smoke:create-order

# ISR 健康形状（连打看翻转，别只看单次值）
powershell -NoProfile -File scripts/isr-watch.ps1 -Rounds 5 -GapSeconds 15

# Workers Cache 存了没：连打两发看 cf-cache-status，再看 Server-Timing 里 cfWorker 有没有消失
# （cfWorker 消失 = 这一发真的没进 Worker）
curl -sI https://onestarry.com/products | grep -iE '^(HTTP|cf-cache-status|cache-control|server-timing|age)'
# 探针穿透验证：带 probe= 参数的那发必须没有 cf-cache-status: HIT，且 x-nextjs-cache 有值
curl -sI "https://onestarry.com/products?probe=$(date +%s)" | grep -iE '^(cf-cache-status|x-nextjs-cache)'
# 静态资源对照（走 Workers Assets、不经 Worker 代码，应该一直能 MISS→HIT）
curl -sI https://onestarry.com/_next/static/chunks/44f_n5nrx9el0.css | grep -iE '^(cf-cache-status|cache-control)'

# 算“到底省了多少”：必须剥掉 TLS/网络段，否则你量到的是自己那条链路
curl -s -o /dev/null -D - -w 'tls=%{time_appconnect} ttfb=%{time_starttransfer}\n' https://onestarry.com/products
grep -iE '^(cf-cache-status|server-timing)'   # server = ttfb − tls；没有 server-timing = 没进 Worker

# 按需失效通道（带密钥那一发才通；没配 secret / 错密钥一律 401，白名单外路径进 rejected）
curl -s -X POST https://onestarry.com/api/internal/invalidate -H 'authorization: Bearer $INVALIDATE_SECRET' -H 'content-type: application/json' -d '{"paths":["/products/ceramic-mug","/admin/x"]}'
# 验它真生效：连打两发穿透边缘的（带唯一 probe 参数），必须是 STALE(s-maxage=2) → 几秒后 HIT(s-maxage≈59)
# 不是 MISS —— revalidatePath 是“标为过期 + 后台重渲染”，旧体还会发一次
curl -sI "https://onestarry.com/products/ceramic-mug?probe=$RANDOM" | grep -iE '^(x-nextjs-cache|cache-control)'
sleep 5; curl -sI "https://onestarry.com/products/ceramic-mug?probe=$RANDOM" | grep -iE '^(x-nextjs-cache|cache-control)'

# 线上版本确认（含 ISR 探针结论）
curl -s https://onestarry.com/api/health
```

乐观 UI 的自检（只能在浏览器里看）：后台类目/市场、评论审核、购物车数量各改一次，
DevTools Console 里**不应**出现 `An optimistic state update occurred outside a transition or action`；
同时故意填一个重复的 `code` 新增市场，应当看到红色报错并且那条虚线假行自己消失。
