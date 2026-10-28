import { receiveStock, idempotencyKeys } from "@onestarry/db";
import { getDb } from "@/lib/db";
import { checkAccess } from "../../_lib/access";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * POST /integration/stock/receive —— 外部采购/生产程序入库回写（"进"）。
 * body: { variantId, qtyReceived, qtyDamaged?, unitCostCents, currency, supplierRef?, externalPoRef? }
 * 头：Idempotency-Key 防重放（写接口幂等）+ X-Integration-Key 共享密钥（见 _lib/access）。
 * 落库：追加 receive/damage 流水 + 原子增 on_hand。账本分录留 TODO（见 integration.ts）。
 */
export async function POST(req: Request): Promise<Response> {
    // 写接口：密钥未配置时 checkAccess 返回 501（本集成未启用），比只读更保守。
    const a = await checkAccess(req, { write: true });
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
        !UUID_RE.test(variantId) ||
        !Number.isInteger(qtyReceived) ||
        qtyReceived <= 0 ||
        !Number.isInteger(qtyDamaged) ||
        qtyDamaged < 0 ||
        qtyDamaged > qtyReceived || // 破损不能多于实收，否则 net 为负=凭空扣库存
        !Number.isInteger(unitCostCents) ||
        unitCostCents < 0 ||
        !currency
    ) {
        return Response.json(
            {
                error:
                    "required/invalid: variantId(uuid), qtyReceived(int>0), qtyDamaged(0<=int<=qtyReceived), unitCostCents(int>=0), currency",
            },
            { status: 400 },
        );
    }

    const db = getDb();
    const idemKey = req.headers.get("idempotency-key");

    // 幂等键与库存写入**同一事务**（审查 H3）：旧实现先提交幂等键再干活，receiveStock 一旦抛错，
    // 键已落库 → 同 key 的重试被永久判"重放"，库存却从未增加且无痕迹。放进一个事务后，
    // 业务写失败 → 事务回滚 → 键也消失，重试可正常执行。onConflictDoNothing().returning()
    // 返回 0 行 = 键已存在 = 真重放（也是唯一的并发闸，无需先 SELECT）。
    const outcome = await db.transaction(async (tx) => {
        if (idemKey) {
            const inserted = await tx
                .insert(idempotencyKeys)
                .values({ key: idemKey, scope: "integration.receive", expiresAt: new Date(Date.now() + 86_400_000) })
                .onConflictDoNothing()
                .returning({ id: idempotencyKeys.id });
            if (inserted.length === 0) return { deduplicated: true } as const;
        }
        const r = await receiveStock(tx, { variantId, qtyReceived, qtyDamaged, unitCostCents, currency, supplierRef, externalPoRef });
        return { deduplicated: false, onHandAfter: r.onHandAfter } as const;
    });

    if (outcome.deduplicated) return Response.json({ ok: true, deduplicated: true }, { status: 200 });
    return Response.json({ ok: true, onHandAfter: outcome.onHandAfter }, { status: 201 });
}
