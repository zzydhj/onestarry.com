import { getInventoryLevels } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { checkAccess } from "../_lib/access";

export const dynamic = "force-dynamic";

/** GET /integration/inventory —— 全变体库存水位（on_hand/reserved/available + SKU），低水位在前，驱动采购。 */
export async function GET(req: Request): Promise<Response> {
    const a = await checkAccess(req);
    if (!a.ok) return Response.json({ error: a.error }, { status: a.status });
    const items = await getInventoryLevels(getDb());
    return Response.json({ items, generatedAt: new Date().toISOString() });
}
