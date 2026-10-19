import { createDb, listLegalEntities, listMarkets } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { Button, Input, Select, TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";
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
                    <Input name="code" placeholder="code 如 gb" required className="py-1.5 text-sm" />
                    <Input name="name" placeholder="名称 如 United Kingdom" required className="w-40 py-1.5 text-sm" />
                    <Input name="currency" placeholder="币种 GBP" required className="w-24 py-1.5 text-sm" />
                    <Select name="legalEntityId" required className="py-1.5 text-sm">
                        {entities.map((e) => (
                            <option key={e.id} value={e.id}>{e.displayName}（{e.jurisdiction}）</option>
                        ))}
                    </Select>
                    <Select name="pricingMode" className="py-1.5 text-sm">
                        <option value="net_plus_tax">net_plus_tax（净价+税）</option>
                        <option value="fixed_gross">fixed_gross（含税全包）</option>
                    </Select>
                    <Select name="dutyPresentation" className="py-1.5 text-sm">
                        <option value="separate_line">separate_line（关税单列）</option>
                        <option value="included_in_price">included_in_price（含在价内）</option>
                    </Select>
                    <Button type="submit" size="sm">新增市场</Button>
                </form>
            )}

            <TableFrame className="mt-6">
                <table className="w-full text-sm">
                    <THead>
                        <tr>
                            <Th>code</Th>
                            <Th>名称</Th>
                            <Th>币种</Th>
                            <Th>定价模式</Th>
                            <Th>关税呈现</Th>
                            <Th>法人</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {markets.map((m) => (
                            <Tr key={m.id}>
                                <Td className="font-mono">{m.code}</Td>
                                <Td>{m.name}</Td>
                                <Td>{m.currency}</Td>
                                <Td>{m.pricingMode}</Td>
                                <Td>{m.dutyPresentation}</Td>
                                <Td className="text-xs text-muted">{entityName(m.legalEntityId)}</Td>
                            </Tr>
                        ))}
                    </tbody>
                </table>
            </TableFrame>
            <p className="mt-3 text-xs text-muted">
                注：新建市场后，现有变体会在下一次价格重算时为该市场生成价格缓存（当前 FX/税率未接入，按基价币种 1:1、税/关 0 占位）。
            </p>
        </main>
    );
}
