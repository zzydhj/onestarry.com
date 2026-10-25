import { cache } from "react";
import { createDb, type Db } from "@onestarry/db";

/**
 * 请求级共享的数据库客户端（= **一次导航只用一条连接**）。
 *
 * 为什么要这一层（2026-10-25 线上取证，`wrangler tail` 的 Worker 内部视角）：
 *   GET /api/health      wall=   6–121ms  cpu=  5ms   ← 不碰库，平台本身很快
 *   GET /signin（已登录） wall=1677–2017ms  cpu= 34ms   ← 只做鉴权，不查页面数据
 *   GET /products        wall=2361–2930ms  cpu= 44–55ms
 *   GET /orders          wall=2396–2800ms  cpu= 50ms
 *   GET /categories      wall=2543–2601ms  cpu= 49ms
 * CPU 只有 50ms，其余全是 I/O 等待；而且**复杂度完全不同的页面耗时几乎一样** —— 说明这是
 * 每请求的固定开销，不是"某个页面查得多"。固定开销的来源是**连接握手次数**：
 * 一次页面渲染原先要建 3 条数据库连接 —— better-auth 自己 `createDb` 一条（packages/auth）、
 * 守卫查权限集再一条（lib/auth.ts）、页面/Action 又一条。而一条新的 postgres 连接不是 1 次
 * 往返，是 **4–6 次**（TCP + TLS + SCRAM 认证 + 参数协商），单趟 150–200ms → 白付 1.8–2.2 秒。
 * 数字与实测严丝合缝：只鉴权（2 条连接）1.8s，鉴权 + 页面（3 条）2.4s。
 *
 * 做法：用 React 的 `cache()` 做**请求级** memo，键就是连接串。同一次导航/同一次 Action 里
 * 所有调用点拿到同一个客户端 → 1 条连接。跨请求**不**缓存（`cache()` 的边界就是本次请求），
 * 所以 `packages/db` 里那条"每请求新建 client"的防呆决定完全保留 —— 它防的是 isolate
 * 冻结/解冻重置 socket 后拿到死连接（历史上造成间歇 500），这里没有任何跨请求复用。
 *
 * ⚠ 别把这层挪进 `packages/db`：那里还被 node 脚本与 packages/jobs（长驻 isolate 的 cron Worker）
 * 使用，那些运行时没有 React 的请求边界，`cache()` 会退化成**进程级**缓存 —— 正好把上面那个
 * 死连接问题重新引入。请求生命周期是 Next 的概念，所以这层属于 apps/admin。
 */
export const getRequestDb = cache((connString: string): Db => createDb(connString));
