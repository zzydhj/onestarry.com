# AGENTS.md — 与这个项目打交道的规矩

> 本文件只回答一个问题：**改这个项目该守什么、该写哪儿、哪些方案已经否决过**。
> 设计蓝图看架构方案文档，代码现状看实现地图，性能真相看 PERF —— 那些内容**不要抄到这里**，这里只放一行口径 + 一个指针。
> 放根目录而不是 `docs/` 是因为：主流编码代理会自动读取根目录 `AGENTS.md`，新开会话不必由人再贴一遍。

## 0. 文档地图：先决定该写进哪个文件

| 文件 | 只回答这个问题 | 什么时候改 |
|---|---|---|
| `全球电商模板-架构方案-交叉验证版.md` | **为什么这样设计**（蓝图/表归属/施工顺序） | 只在决策变化时；**不写代码状态** |
| `docs/IMPLEMENTATION.md` | **代码做到哪了、差多少**（实现地图，§9 未接线 / §10 偏差 / §12 体检） | 每次改完代码 |
| `docs/PERF.md` | **性能真相 + 怎么量才不出错**（实测数据、判读法、工具陷阱） | 拿到新测量时 |
| `docs/DR-RUNBOOK.md` / `UPGRADE-RUNBOOK.md` / `REBRAND.md` | **怎么操作**（灾备 / 升级 / 换皮） | 流程变化时 |
| 代码注释（就近） | **局部不变量**（改这个文件时必须知道的事） | 改这段代码时 |
| **本文件** | **纪律与约定**（跨模块通用、不专属任何单个文件） | 又踩到一次新坑时 |

**一条事实只允许有一个真源**，别处只放指针。发现同一事实写在两处，以内容更具体的那个为准并删掉副本。

## 1. 上线判定（每次部署必做，不许凭感觉）

1. **判断"新构建是否已上线"只能比构建指纹**：`curl https://admin.onestarry.com/api/health` 的**顶层** `gitSha`
   （⚠ 不是 `app.gitSha` —— 读错层级曾空转 13 分钟误判"没部署"）。
   Cloudflare Workers Builds **会静默漏掉某一次 push**，所以"推了 ≠ 上线了"。
2. 本仓**没有** `.github/workflows`，CI 就是 Workers Builds（`git push` 触发）。别去找 GitHub Actions，也别往这儿加 workflow。
3. 部署是否真的换了行为，用**新构建独有的特征**验证（新类名 / 新路由状态码 / `/api/health` 的字段），比盲等可靠。

## 2. 代码不变量（违反 = 事故；细节真源在指针处）

| 口径（一行，可判定） | 真源 |
|---|---|
| 金额只从库里取；capture 前必过三道闸（是我们建的那张 / `custom_id` 等于我方单号 / 金额等于应付） | `apps/web/app/api/paypal/capture/route.ts` |
| PSP 事件名**逐字**照官方；错一个字母的代价是静默归 `ignored`，不是报错 | `packages/core/src/paypal.ts` |
| 一切外部入口默认值必须 **fail-closed**（没配 = 不收、不动账，而不是"信它"） | `apps/web/app/api/webhooks/[provider]/route.ts`、`lib/paypal.ts` 的沙箱闸 |
| 任何快路/缓存都必须能退回权威；缓存异常一律吞掉并降级 | `apps/admin/lib/session-cache.ts` |
| **不给 `force-dynamic` 页面加 `loading.tsx`**（会把 `redirect()`/`notFound()` 变成 HTTP 200 软响应） | `apps/web/app/pay/[orderNumber]/page.tsx` 头注 |
| 后台导航一律 `prefetch={false}`，预取靠悬停（进视口预取会挤干连接池） | `apps/admin/components/AdminSideNav.tsx` |
| 配置状态对外只报**布尔**，绝不外泄任何凭据值 | `apps/web/app/api/health/route.ts` |

## 3. 测量与查案工法（细节真源 `docs/PERF.md`）

- `wrangler tail --format json` 的记录字段顺序是 **`wallTime` → `cpuTime` → `outcome` 在开头，`url` 在后面**；
  按"从某个字段往前/往后开窗"解析会**整体错位**，本仓已因此作废过两个错误结论。
- **冷 isolate 的模块编译计入 `cpuTime`** —— 别把冷启动当成 I/O 等待。
- 测量脚本收尾必须**杀掉 node 子进程**：`wrangler tail` 的子进程继承 stdout 句柄，只 kill 外层 cmd 会让管道永不 EOF。
- PowerShell 中文脚本**必须带 BOM**，否则按 GBK 读成非法 token（或干脆写纯 ASCII）。
- **同一 `max:1` 连接里 `Promise.all` 不省时间**（实测 1511 vs 1531ms）；省往返只能靠**把多条 SQL 合成一条**。
- 下结论前先分清"我量到的是链路，还是对方的处理"：剥掉 TLS/网络段再算收益。

## 4. 协作与卫生约定

- **框架必须清晰、代码不混乱**：组件职责单一、样式归属明确、文件组织有序、不留冗余与耦合。
- **不留死代码**：方案被否决就把代码删干净，只留取证记录；临时脚本（`tmp-*.ts`、探针）用完即删。
- **过程产物写 `%TEMP%`，不落项目根目录**；清理前先查 `.gitignore`，移动而不是硬删。
- 改性能相关任何东西之前，先看 `docs/PERF.md` 有没有已钉住的结论；有冲突以**实测**为准并更新该文件。
- 历史硬约束：**速度不能变慢，而且必须更稳定**。任何"提速方案"若带来新的失败模式，先写清代价再动手。
- 文档写作与本仓注释同口径：写"为什么"和"不这样做会怎样"，不写空泛的"注意"。

## 5. 已经否决过的方案（别再提，理由已取证）

| 方案 | 为什么不行 | 取证在哪 |
|---|---|---|
| **B：绕过 better-auth 直查会话表做快路** | 会话 cookie 是 `token.HMAC-SHA256签名`（长 81），`getSessionCookie()` 只取值不验签 ⇒ 快路必须复刻私有验签 = 认证绕过风险 | `docs/PERF.md` §2（⛔ 段） |
| **区域 Cache Rules 缓存 HTML** | Worker 自渲染的站点区域缓存完全不生效；正解是 Workers Cache | `docs/PERF.md` §6 |
| **下单封装成 Postgres RPC** | 违反铁律②（业务逻辑不入 PL/pgSQL），收益被 Smart Placement 抵消 | 架构方案 §15 备注 |
| **Hyperdrive 查询缓存** | 官方明确写操作不使缓存失效；本站三类读一致性敏感（读车 / 查可售 / 写完即读）。开关在 **Hyperdrive 资源上、不在仓库里**（`npx wrangler hyperdrive get <id>` 可复核） | `docs/PERF.md` “Hyperdrive 查询缓存：结论是不开”段 |
| **`withRegionalCache`** | 给"条目年龄"引入第二套时钟，导致 PDP 永不 HIT | `docs/PERF.md` §6 |
| **把主库挪到近亚洲区域** | 那是拿欧美客户结账延迟换一个人后台手感；US-East 是有意决策 | 架构方案 §1、`docs/PERF.md` §1 |
| **换 Supabase 会更快** | 慢的是“谁去查它”和跨洋两趟，不是 Postgres 厂商；直连形态才省那一趟，而它的代价是后台重写 + 每张表的 RLS 策略都得写对 + 账本暴露给浏览器 | `docs/PERF.md` §1.1 |

## 6. 待办看这里，不要看本文件

未完成项一律登记在 `docs/IMPLEMENTATION.md`（§9 未接线清单 / §10 偏差登记 / §12 体检）与架构方案 §15.1「施工尾巴」。
本文件**不维护待办**，否则就成了第三份会漂移的清单。
