import Link from "next/link";
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
        <main style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/">← 返回后台首页</Link></p>
            <h1 style={{ fontSize: 22 }}>市场配置 <span style={{ fontSize: 13, color: "#888" }}>（{markets.length}）</span></h1>

            {entities.length === 0 ? (
                <p style={{ color: "#b00000" }}>还没有法人主体（legal entity），无法新建市场。</p>
            ) : (
                <form action={createMarketAction} style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0", alignItems: "center" }}>
                    <input name="code" placeholder="code 如 gb" required style={{ padding: 6, width: 90 }} />
                    <input name="name" placeholder="名称 如 United Kingdom" required style={{ padding: 6, width: 160 }} />
                    <input name="currency" placeholder="币种 GBP" required style={{ padding: 6, width: 70 }} />
                    <select name="legalEntityId" required style={{ padding: 6 }}>
                        {entities.map((e) => (
                            <option key={e.id} value={e.id}>{e.displayName}（{e.jurisdiction}）</option>
                        ))}
                    </select>
                    <select name="pricingMode" style={{ padding: 6 }}>
                        <option value="net_plus_tax">net_plus_tax（净价+税）</option>
                        <option value="fixed_gross">fixed_gross（含税全包）</option>
                    </select>
                    <select name="dutyPresentation" style={{ padding: 6 }}>
                        <option value="separate_line">separate_line（关税单列）</option>
                        <option value="included_in_price">included_in_price（含在价内）</option>
                    </select>
                    <button type="submit">新增市场</button>
                </form>
            )}

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                        <th style={{ padding: "6px 8px" }}>code</th>
                        <th style={{ padding: "6px 8px" }}>名称</th>
                        <th style={{ padding: "6px 8px" }}>币种</th>
                        <th style={{ padding: "6px 8px" }}>定价模式</th>
                        <th style={{ padding: "6px 8px" }}>关税呈现</th>
                        <th style={{ padding: "6px 8px" }}>法人</th>
                    </tr>
                </thead>
                <tbody>
                    {markets.map((m) => (
                        <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{m.code}</td>
                            <td style={{ padding: "6px 8px" }}>{m.name}</td>
                            <td style={{ padding: "6px 8px" }}>{m.currency}</td>
                            <td style={{ padding: "6px 8px" }}>{m.pricingMode}</td>
                            <td style={{ padding: "6px 8px" }}>{m.dutyPresentation}</td>
                            <td style={{ padding: "6px 8px", color: "#888", fontSize: 12 }}>{entityName(m.legalEntityId)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p style={{ fontSize: 12, color: "#999", marginTop: 12 }}>
                注：新建市场后，现有变体会在下一次价格重算时为该市场生成价格缓存（当前 FX/税率未接入，按基价币种 1:1、税/关 0 占位）。
            </p>
        </main>
    );
}
