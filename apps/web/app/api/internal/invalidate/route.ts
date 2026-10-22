import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { planInvalidatePaths, secretsMatch } from "@onestarry/core";

/** 不能让这发请求本身被缓存（/api/* 也已在 next.config 里显式补了 no-store）。 */
export const dynamic = "force-dynamic";

/**
 * 前台按需失效入口。调用方只有一个：apps/admin（**另一个 Worker**）。
 *
 * ⚠ 为什么非要走 HTTP 而不是在 admin 里直接 revalidatePath：
 *   `next/cache` 的失效只作用于**当前应用自己的**缓存与真值源，admin 进程里的调用碰不到
 *   web 的 R2 ISR 条目。2026-10-22 之前 admin 商品 action 里那 10 处 revalidatePath 是双重空转
 *   —— 既跨不了 app，又把实体 id 拼进了 `/products/[slug]`（那路径本身 404、Next 不报错）。
 *   完整取证见 docs/PERF.md §7。
 *
 * 兜底关系：这端点挂了 / 密钥没配 / 路径被白名单拒掉，都不影响正确性 ——
 * 前台每个公共读页都有 `revalidate` 定时器会自己追平。
 *
 * ⚠ 能力边界（2026-10-22 实测，别再把它说大）：**构建期预渲染上传的条目对 revalidatePath 免疫**。
 *   对这类路由（首页/列表/PDP/类目/品牌/法律/CMS 正文）本端点只会返回 ok，倒计时不会被打断；
 *   它们真正可靠的“改完可见”上界是页自己的 `revalidate`（已全部统一为 60s）。
 *   实测形状：POST 返回 {"ok":true,"revalidated":["/legal/privacy"]} 后连打 10 发穿透边缘的探测，
 *   s-maxage 从 3213 单调降到 3191，一次 STALE 都没出现。
 *   反之，只运行时写过条目的路由（无预渲染、首请求自己渲染的）确实会被当场打断 —— 那部分是真效果。
 *   要连预渲染条目也立刻清掉，得往下走真删除（NEXT_INC_CACHE_R2_BUCKET 已绑在本 Worker）或边缘 cache.purge()，
 *   两者都还没做，证据与权衡见 docs/PERF.md §7。
 *
 * 已知边界（有意不做，别当成漏修）：边缘那层 Workers Cache 的副本不受 revalidatePath 管辖，
 * 它只会把自己存到的 s-maxage 走完（ISR 的 STALE 那一发只给 2 秒，所以通常也就 2 秒内追平）。
 * 真要把边缘也立刻清掉，得在这里补 `cache.purge()`（`cloudflare:workers`），见 §6。
 */
export async function POST(req: Request) {
    const { env } = getCloudflareContext();

    const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!secretsMatch(given, env.INVALIDATE_SECRET)) {
        // 不区分"密钥错"与"没配密钥"，避免给探测者递线索；没配时同样是 401。
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: "body 必须是 JSON" }, { status: 400 });
    }

    const { accepted, rejected } = planInvalidatePaths((payload as { paths?: unknown })?.paths);
    const done: string[] = [];
    for (const path of accepted) {
        try {
            revalidatePath(path);
            done.push(path);
        } catch (e) {
            // 单条失败不拖垮整批：剩下的继续失效，失败条目靠 60 秒定时器追平。
            console.error("[invalidate] revalidatePath 失败：", path, e);
        }
    }

    return NextResponse.json({
        ok: true,
        revalidated: done,
        // 把拒绝原因原样带回去，让 admin 的日志能看出"这个后台动作还没接上白名单"，
        // 而不是重演 §7 那种静默空转。
        rejected,
    });
}
