import { and, eq } from "drizzle-orm";
import { idempotencyKeys, receiveStock } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { checkAccess } from "../../_lib/access";

export const dynamic = "force-dynamic";

/**
 * POST /integration/stock/receive —— 外部采购/生产程序入库回写（"进"）。
 * body: { variantId, qtyReceived, qtyDamaged?, unitCostCents, currency, supplierRef?, externalPoRef? }
 * 头：可选 Idempotency-Key 防重放（写接口幂等）。
 * 落库：追加 receive/damage 流水 + 增 on_hand。账本分录留 TODO（见 integration.ts）。
 */
export async function POST(req: Request): Promise<Response> {
    const a = checkAccess(req);
    if (!a.ok) return Response.json({ error: a.error }, { status: a.status });

    let body: Record<string, unknown>;
    try {
        body = (await req.json()) as Record<string, unknown>;
    } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const variantId = String(body.variantId ?? "");
    const qtyReceived = Number(body.qtyReceived);
    const qtyDamaged = body.qtyDamaged != null ? Number(body.qtyDamaged) : 0;
    const unitCostCents = Number(body.unitCostCents);
    const currency = String(body.currency ?? "").toUpperCase();
    const supplierRef = body.supplierRef != null ? String(body.supplierRef) : null;
    const externalPoRef = body.externalPoRef != null ? String(body.externalPoRef) : null;

    if (
        !variantId ||
        !Number.isInteger(qtyReceived) ||
        qtyReceived <= 0 ||
        !Number.isInteger(unitCostCents) ||
        unitCostCents < 0 ||
        !currency
    ) {
        return Response.json(
            { error: "required/invalid: variantId, qtyReceived(int>0), unitCostCents(int>=0), currency" },
            { status: 400 },
        );
    }

    const db = getDb();
    const idemKey = req.headers.get("idempotency-key");
    if (idemKey) {
        const hit = (
            await db
                .select({ id: idempotencyKeys.id })
                .from(idempotencyKeys)
                .where(and(eq(idempotencyKeys.key, idemKey), eq(idempotencyKeys.scope, "integration.receive")))
                .limit(1)
        )[0];
        if (hit) return Response.json({ ok: true, deduplicated: true }, { status: 200 });
        await db
            .insert(idempotencyKeys)
            .values({ key: idemKey, scope: "integration.receive", expiresAt: new Date(Date.now() + 86_400_000) });
    }

    const result = await receiveStock(db, { variantId, qtyReceived, qtyDamaged, unitCostCents, currency, supplierRef, externalPoRef });
    return Response.json({ ok: true, onHandAfter: result.onHandAfter }, { status: 201 });
}
