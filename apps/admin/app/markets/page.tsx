import { createDb, listLegalEntities, listMarkets } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { createMarketAction } from "./actions";

export const dynamic = "force-dynamic";

/** 市场配置（受保护）：列市场 + 新建（选法人/定价模式/关税呈现）。 */
export default async function MarketsPage() {
    const { env } = await requireAdmin();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const [markets, entities] = await Promise.all([listMarkets(db), listLegalEntities(db)]);
    const entityName = (id: string) => entities.find((e) => e.id === id)?.displayName ?? id;

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-xl font-semibold">
                市场配置 <span className="ml-1 text-sm font-normal text-muted">（{markets.length}）</span>
            </h1>

            {entities.length === 0 ? (
                <p className="mt-4 text-sm text-red-600">还没有法人主体（legal entity），无法新建市场。</p>
            ) : (
                <form action={createMarketAction} className="mt-4 flex flex-wrap items-center gap-2">
                    <input name="code" placeholder="code 如 gb" required className="rounded-md border border-line px-3 py-1.5 text-sm" />
                    <input name="name" placeholder="名称 如 United Kingdom" required className="w-40 rounded-md border border-line px-3 py-1.5 text-sm" />
                    <input name="currency" placeholder="币种 GBP" required className="w-24 rounded-md border border-line px-3 py-1.5 text-sm" />
                    <select name="legalEntityId" required className="rounded-md border border-line px-3 py-1.5 text-sm">
                        {entities.map((e) => (
                            <option key={e.id} value={e.id}>{e.displayName}（{e.jurisdiction}）</option>
                        ))}
                    </select>
                    <select name="pricingMode" className="rounded-md border border-line px-3 py-1.5 text-sm">
                        <option value="net_plus_tax">net_plus_tax（净价+税）</option>
                        <option value="fixed_gross">fixed_gross（含税全包）</option>
                    </select>
                    <select name="dutyPresentation" className="rounded-md border border-line px-3 py-1.5 text-sm">
                        <option value="separate_line">separate_line（关税单列）</option>
                        <option value="included_in_price">included_in_price（含在价内）</option>
                    </select>
                    <button type="submit" className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90">
                        新增市场
                    </button>
                </form>
            )}

            <div className="mt-6 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                    <thead className="border-b border-line text-left text-muted">
                        <tr>
                            <th className="px-4 py-2 font-medium">code</th>
                            <th className="px-4 py-2 font-medium">名称</th>
                            <th className="px-4 py-2 font-medium">币种</th>
                            <th className="px-4 py-2 font-medium">定价模式</th>
                            <th className="px-4 py-2 font-medium">关税呈现</th>
                            <th className="px-4 py-2 font-medium">法人</th>
                        </tr>
                    </thead>
                    <tbody>
                        {markets.map((m) => (
                            <tr key={m.id} className="border-b border-line last:border-0">
                                <td className="px-4 py-2 font-mono">{m.code}</td>
                                <td className="px-4 py-2">{m.name}</td>
                                <td className="px-4 py-2">{m.currency}</td>
                                <td className="px-4 py-2">{m.pricingMode}</td>
                                <td className="px-4 py-2">{m.dutyPresentation}</td>
                                <td className="px-4 py-2 text-xs text-muted">{entityName(m.legalEntityId)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="mt-3 text-xs text-muted">
                注：新建市场后，现有变体会在下一次价格重算时为该市场生成价格缓存（当前 FX/税率未接入，按基价币种 1:1、税/关 0 占位）。
            </p>
        </main>
    );
}
