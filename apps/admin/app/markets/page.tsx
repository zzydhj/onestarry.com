import { listLegalEntities, listMarkets } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { MarketsPanel } from "./MarketsPanel";

export const dynamic = "force-dynamic";

/**
 * 市场配置（受保护）：列市场 + 新建（选法人/定价模式/关税呈现）。
 * 表单与表格在客户端组件里做乐观更新；这里只取真值传下去。
 */
export default async function MarketsPage() {
    const { env } = await requirePermission(PERMISSIONS.marketWrite);
    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    // 写成一排 Promise.all 只是把"互不依赖"说明白：max:1 连接上它们仍然串行，
    // 并不省时间（探针⑥）；要真省往返得改单条 SQL 聚合，或开 Hyperdrive 缓存。
    const [markets, entities] = await Promise.all([listMarkets(db), listLegalEntities(db)]);

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-xl font-semibold">
                市场配置 <span className="ml-1 text-sm font-normal text-muted">（{markets.length}）</span>
            </h1>

            <MarketsPanel markets={markets} entities={entities} />

            <p className="mt-3 text-xs text-muted">
                注：新建市场后，现有变体会在下一次价格重算时为该市场生成价格缓存（当前 FX/税率未接入，按基价币种 1:1、税/关 0 占位）。
            </p>
        </main>
    );
}
