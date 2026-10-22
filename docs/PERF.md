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

## 6. 已知但尚未处置

- **Hyperdrive 查询缓存是关的**：`caching.disabled = true`（`npx wrangler hyperdrive get <id>` 可复核）。
  文档/历史结论里曾按「已开启」写过，实际未开启。开启属于生产配置变更，需要显式批准（TTL ≤ 60s、region `AWS_US_EAST_2`）。
- 探针流量本身会让被采样的页面保持「热」状态（每 5 分钟触发一次刷新）。这是副作用，也是最小成本的预热。

## 7. 复现清单

```bash
# 手法有效性（串行/并行/合并、冷连接、下单写路径）
pnpm --filter @onestarry/db perf:probe

# 读路径与下单写入的口径冒烟（连真实库，不改数据）
pnpm --filter @onestarry/db smoke:queries
pnpm --filter @onestarry/db smoke:create-order

# ISR 健康形状（连打看翻转，别只看单次值）
powershell -NoProfile -File scripts/isr-watch.ps1 -Rounds 5 -GapSeconds 15

# 线上版本确认（含 ISR 探针结论）
curl -s https://onestarry.com/api/health
```

乐观 UI 的自检（只能在浏览器里看）：后台类目/市场、评论审核、购物车数量各改一次，
DevTools Console 里**不应**出现 `An optimistic state update occurred outside a transition or action`；
同时故意填一个重复的 `code` 新增市场，应当看到红色报错并且那条虚线假行自己消失。
