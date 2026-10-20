import { getDemandFeed } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { checkAccess } from "../_lib/access";

// 对外集成只读接口：绝不缓存、每次现查（数据敏感、且非公开 SEO 页）。
export const dynamic = "force-dynamic";

/** GET /integration/demand?sinceDays=30 —— 已付未发订单的脱敏需求（SKU/数量/HS/原产国，无 PII）。 */
export async function GET(req: Request): Promise<Response> {
    const a = checkAccess(req);
    if (!a.ok) return Response.json({ error: a.error }, { status: a.status });
    const url = new URL(req.url);
    const sinceDays = Number(url.searchParams.get("sinceDays") ?? "30") || 30;
    const items = await getDemandFeed(getDb(), { sinceDays });
    return Response.json({ items, generatedAt: new Date().toISOString() });
}
