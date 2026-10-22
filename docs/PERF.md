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

## 6. CDN 边缘缓存（Cache Rule）—— 目标形状、配置与红线

### 现在只有 R2 一层（实测，2026-10-22）

访客请求的完整链路是：**Cloudflare CDN → Worker（Next）→ R2**。后两层都在，第一层今天不存在：

| 测什么 | 结果 | 含义 |
| --- | --- | --- |
| `/`、`/products`、PDP 的响应头 | **无 `cf-cache-status`、无 `Age`** | CDN 一份 HTML 都没存 |
| `x-nextjs-cache: HIT` 时的 TTFB | **0.9–2.3s** | 每次都真的进 Worker 跨洋读一次 R2（真边缘命中是几十毫秒量级） |
| 三条路由是否发 `Set-Cookie` | **全部不发**（GDPR 同意 cookie 是 `document.cookie` 写的） | 边缘缓存不会把 A 的 cookie 回给 B |
| 按国家/IP 分流 | `CF-IPCountry` / `request.geo` / `middleware` **全仓 0 处**；`/products?market=us&page=2` 直接复用 `/products` 那份条目 | 内容人人同一份，可以全局缓存 |
| 不存在的 slug | `404` + `private, no-cache, no-store` | 错误页不会被缓存 |
| `/products/<slug>/review` | `307` + `private, no-cache, no-store` | 登录页；但不能依赖这个兜底，表达式要自己收严 |

> 历史上那层 `withRegionalCache` **不是** CDN 缓存 HTML：它是 Worker 用 Cloudflare Cache API
> （`caches.default()`）在**本 colo** 给 **R2 里的 ISR 条目**做副本，缓存对象是渲染产物而不是响应。
> 它确实让 HIT 变成 0.11s，代价就是 §3 那套「两套年龄真值」。拆对了，但也顺带把唯一能藏住
> 跨洋延迟的东西拆掉了 —— 所以这一节要补的是**真正那一层**，不是把它装回去。

### 要建的规则（脚本：`scripts/cf-edge-cache.ps1`）

`Rules → Cache Rules`，action `set_cache_settings`，description **`onestarry-ISR-html`**（脚本靠这个名字认出并只动这一条）：

```jsonc
{
  "expression": "(http.request.method eq \"GET\" or http.request.method eq \"HEAD\") and (http.request.uri.path eq \"/\" or http.request.uri.path eq \"/products\" or http.request.uri.path matches \"^/products/[^/]+$\") and not http.user_agent eq \"onestarry-isr-probe\"",
  "action_parameters": {
    "cache": true,
    "edge_ttl":    { "mode": "bypass_by_default" },
    "browser_ttl": { "mode": "respect_origin" }
  }
}
```

每个决定都有实测或文档依据，改之前请先看完：

- **`cache: true`** —— Cloudflare 默认不把 HTML 当可缓存类型；没有这个开关，`fixISRHeaders` 写的 `s-maxage` 就是「有牌没打」。
- **`edge_ttl.mode = bypass_by_default`，不是 `respect_origin`**：两者对「有 cache-control」的响应行为相同，差别在**没头时**：
  `respect_origin` 退回 Cloudflare 默认 TTL（小时级），而**动态页恰好就是没头的**（§3 里 PDP 无 Cache-Control 同一现象）。
  今天这三条路由都有头，看不出差别；将来谁在页里加了 `cookies()` 、页面变动态，`respect_origin` 就会把某个人的页面缓存几小时发给所有人。
  `bypass_by_default` = **只有源站显式写了 TTL 的响应才进 CDN**，把这个未来漏洞从根上堵掉。
- **`browser_ttl = respect_origin`**（不设这一条会落回规则自己的 Browser TTL，默认数小时）：源站只写 `s-maxage` 不写 `max-age`，
  浏览器本来就不该缓存；否则回访用户长期看旧页，而且请求根本不到我们这里。
- **表达式用 `matches "^/products/[^/]+$"` 而不是 `starts_with "/products/"`**：后者会把 `/products/<slug>/review`（登录页）和
  `/products/`、`/api/...` 之类一并裹进来。只给无个性化的读页开 —— **红线：`/cart`、`/checkout`、`/order/*`、`/account/*`、`/signin`、`/search`、`/api/*` 永远不能加**。
- **排除探针 UA**：`packages/jobs/src/isrProbe.ts` 每 5 分钟以 `UA=onestarry-isr-probe` 打这三条路由，作用是**触发源站刷新 + 读源站的 `x-nextjs-cache`**。
  不排除的话规则一上，探针会被 CDN 直接接住：R2 条目变冷，而且它读到的是缓存里的旧头 → §4 的 verdict 自此失真（又是一个会静默坏掉的东西）。
- **缓存键一个字段都不动**（默认包含全部 query string）：Next 的软导航/预取走 `?_rsc=<hash>`，与 HTML 同路径不同 URL，因此天然不同键。
  如果勾了 “Ignore query string”，HTML 与 RSC flight 载荷会共享一个键 → 先到的那个会反过来发给另一种请求（导航直接坏）。
  代价是带垃圾参数的 URL 会各自存一份，但 TTL 只有 ≤60s，Cloudflare 也只存真被请求过的，不致于被打穿。
- **未改动的已知代价**：源站 STALE 响应带 `stale-while-revalidate=2592000`（OpenNext 写死的 30 天容灾值），
  尊重源站头就意味着「源站出错时 CDN 可以发最多 30 天前的旧页」。只有 Worker 挂掉时才生效；想收就改
  `"serve_stale": { "disable_stale_while_updating": true }`，代价是边界那一发要等回源。

### 落地方式与权限

```powershell
powershell -NoProfile -File scripts/cf-edge-cache.ps1              # 只打印计划 + dashboard 逐项对应，不写
powershell -NoProfile -File scripts/cf-edge-cache.ps1 -Apply       # 写入（幂等：同 description 原地改，不产生重复规则）
powershell -NoProfile -File scripts/cf-edge-cache.ps1 -Verify      # 只读自检，不需要任何 API 权限
powershell -NoProfile -File scripts/cf-edge-cache.ps1 -Rollback    # 只删自己那一条，别人的规则原样带回
```

写操作需要 token 带：**Zone > Cache Rules > Edit**、**Account Rulesets > Edit**、**Account Filter Lists > Edit**。
实测：`wrangler login` 的 OAuth token 只有 `zone:read`，`GET /zones/{id}/rulesets` 与 phase 入口都是 **403**（已在 scopes 原文里核对），
所以这条规则**必须由人在 dashboard 建，或给一个有上述权限的 API token** —— 代码层面无权替代。

### 建完后的判读变化（先记住，否则会把好事当坏事）

- 真浏览器路径：`cf-cache-status: MISS → HIT`，HIT 时 TTFB 从秒级掉到几十毫秒；`s-maxage` 仍是剩余新鲜度倒计时。
  此时**看不到 `x-nextjs-cache` 不是故障**，那份头在缓存体里，代表上一次源站的结论。
- 源站健康度继续走探针那条路径（UA 已排除，永远穿透）：看 `/api/health` 的 `isr`，或 `-Verify` 最后那行 probe。
- 验收的断言对：`-Verify` 里第二发应出 `cf-cache-status: HIT`，而 `[probe]` 行应仍有 `x-nextjs-cache` 且无 `cf-cache-status: HIT`。

---

## 7. 已知但尚未处置

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

# CDN 边缘缓存：看计划 / 看生效没（-Verify 不需权限）
powershell -NoProfile -File scripts/cf-edge-cache.ps1
powershell -NoProfile -File scripts/cf-edge-cache.ps1 -Verify

# 线上版本确认（含 ISR 探针结论）
curl -s https://onestarry.com/api/health
```

乐观 UI 的自检（只能在浏览器里看）：后台类目/市场、评论审核、购物车数量各改一次，
DevTools Console 里**不应**出现 `An optimistic state update occurred outside a transition or action`；
同时故意填一个重复的 `code` 新增市场，应当看到红色报错并且那条虚线假行自己消失。
