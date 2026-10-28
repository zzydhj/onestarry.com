import { getDemandFeed } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { checkAccess } from "../_lib/access";

// 对外集成只读接口：绝不缓存、每次现查（数据敏感、且非公开 SEO 页）。
export const dynamic = "force-dynamic";

/** GET /integration/demand?sinceDays=30 —— 已付未发订单的脱敏需求（SKU/数量/HS/原产国，无 PII）。 */
export async function GET(req: Request): Promise<Response> {
    const a = await checkAccess(req);
    if (!a.ok) return Response.json({ error: a.error }, { status: a.status });
    const url = new URL(req.url);
    // 审查 L-1：旧写法 `Number(x) || 30` 只挡 NaN，-1（未来截点→永远空）、1e9/Infinity（等于无时间过滤→全表扫）都穿过。
    // 在不可信入口夹成整数 1..365：参数缺失→默认 30；非法/非有限→回落 30；越界→夹到边界。
    const param = url.searchParams.get("sinceDays");
    const raw = param === null || param === "" ? 30 : Number(param);
    const sinceDays = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 365) : 30;
    const items = await getDemandFeed(getDb(), { sinceDays });
    return Response.json({ items, generatedAt: new Date().toISOString() });
}
