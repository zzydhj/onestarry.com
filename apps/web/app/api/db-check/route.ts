import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sql } from "drizzle-orm";
import { createDb, legalEntities } from "@onestarry/db";

export const dynamic = "force-dynamic";

/**
 * 演示：通过 Cloudflare Hyperdrive 绑定连 Neon，读真实数据。
 * 证明「页面能读数据库」的端到端链路。
 */
export async function GET() {
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);

    const tableRows = await db.execute<{ c: number }>(
        sql`select count(*)::int as c from information_schema.tables where table_schema = 'public'`,
    );
    const tableCount = tableRows[0]?.c ?? 0;

    const entities = await db
        .select({ id: legalEntities.id, name: legalEntities.displayName, currency: legalEntities.functionalCurrency })
        .from(legalEntities)
        .orderBy(legalEntities.createdAt)
        .limit(10);

    return NextResponse.json({ ok: true, tableCount, entities });
}
