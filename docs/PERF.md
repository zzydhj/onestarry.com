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

### 由此得出的三条硬规矩

1. **同一个 `db` 实例里的多条查询，别用 `Promise.all` 骗自己** —— `max:1` 会把它们排队。要提速就合成一条 SQL（`json_build_object` / `count(*) over ()` / 相关子查询）。
2. **`Promise.all` 只在两个独立连接之间有效** —— 典型例子是结账 action：会话走 better-auth 自己的 client、市场查找走请求内 `db`，这是两个连接，并行确实省一个 RTT。判断标准是「这两次读是不是各自的 client」。
3. **写路径优先合成单条语句** —— 一条语句天然原子，`db.transaction()` 在外层只是多加 `BEGIN`/`COMMIT` **两次跨洋往返**。幂等/金额口径要留在 SQL 的门控里（见 `queries/orders.ts` 的 CTE 写法）。

### postgres-js / drizzle 合并查询时会咬人的四处（都踩过）

- 裸 `select` 出来的 `bigint` 是 **string**，但同一列被塞进 `json_build_object` 后变成 **number**。跨这两种形态别假设类型一致。
- 列别名默认走 `casing: "snake_case"`；**驼峰别名会原样保留**（`itemsJson` 存在、`itemsjson` 不存在）。混用会让前端拿到意外的小写键。
- `Date` 对象不能直接进裸 `sql` 模板（`ERR_INVALID_ARG_TYPE`）→ 传 `sql\`${v.toISOString()}::timestamptz\``。
- 枚举列不吃 `::text` 参数，必须写 `'shipping'::address_type` 这样的字面量；同名字段在多表 join 的 `select` 里要写全限定名 `"orders"."id"`，否则 `42702 column "id" is ambiguous`。

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
2. 等 12s 让 DO 刷新写回；
3. 复查两发 —— 健康必须全是 `HIT`。

判定结论（纯函数在 `packages/core/src/isr.ts`，有单测）：

| verdict | 含义 | 颜色 |
| --- | --- | --- |
| `ok` | 复查全 HIT | 绿 |
| `oscillating` | 复查 HIT/STALE 交替 = 又有两套时钟在打脸 | 黄（连续 2 轮转红） |
| `never_hits` | 从不 HIT = 写回断了/没预渲染 | 红 |
| `not_isr` | 复查全无 `x-nextjs-cache` = 该页已不是 ISR 页（配置被改） | 红 |
| `error` | 请求失败/5xx，结论不可信 | 红 |

报告写 R2 `onestarry-isr-cache/_ops/isr-health.json`（键与类型都在 core，避免各处复制形状）。
读侧两处：`/api/health` 的 `isr` 字段（机器/监控，`null` = 探针还没跑过，**必须与 `ok` 区分**）、
后台概览页运维面板第三张卡（人看，含每路采样轨迹 `STALE→HIT(47)→HIT(35)`）。

**误报控制**：单次异常不报警，`badStreak ≥ 2` 才升红 —— 刚部署完的第一轮可能读到旧条目。

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
- **但预渲染是有代价的：构建期上传的条目对 `revalidatePath` 免疫（实测，本轮钉死）**。
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
