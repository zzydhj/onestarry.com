"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import { Button, Input, Select, TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";
import { createMarketAction } from "./actions";

/** 服务端 listMarkets 的行（这里只声明面板要用的字段，多余字段留着不碍事）。 */
export interface MarketRow {
    id: string;
    code: string;
    name: string;
    currency: string;
    pricingMode: string;
    dutyPresentation: string;
    legalEntityId: string;
}

export interface EntityOption {
    id: string;
    displayName: string;
    jurisdiction: string;
}

const BLANK = { code: "", name: "", currency: "", legalEntityId: "", pricingMode: "net_plus_tax", dutyPresentation: "separate_line" };

/**
 * 市场配置面板（新增走乐观 UI）。
 *
 * 慢在哪：/markets 是 force-dynamic 页，写完一次要整页重渲染 = 会话 + 权限 + 市场 + 法人，
 * 几趟跨洋往返才看得见新行；而且旧写法把 code 冲突吞掉了，失败了页面连个提示都没有。
 *
 * 做法：点下就按服务端口径（code 小写、币种大写）把新行挂进表尾标"写入中"，
 * 服务端确认 + 整页回来后自动换成真行；冲突时假行随 transition 结束自己消失，同时说清原因。
 *
 * 取舍：改成 onSubmit 后没有"无 JS 也能提交"的兜底；提交态由 `pending` 显式驱动
 * （手动 start() 调 action 时 `useFormStatus` 不会替我们置 pending）。
 */
export function MarketsPanel({ markets, entities }: { markets: MarketRow[]; entities: EntityOption[] }) {
    const [form, setForm] = useState(() => ({ ...BLANK, legalEntityId: entities[0]?.id ?? "" }));
    const [ghosts, addGhost] = useOptimistic<MarketRow[], MarketRow>([], (cur, next) => [...cur, next]);
    const [pending, start] = useTransition();
    const [error, setError] = useState<string | null>(null);

    // 与 createMarketAction 完全同口径地归一化，否则假行和真行长得不一样，换行时会"抖一下"
    const draft: MarketRow = {
        id: `draft-${Date.now()}`,
        code: form.code.trim().toLowerCase(),
        name: form.name.trim(),
        currency: form.currency.trim().toUpperCase(),
        legalEntityId: form.legalEntityId,
        pricingMode: form.pricingMode === "fixed_gross" ? "fixed_gross" : "net_plus_tax",
        dutyPresentation: form.dutyPresentation === "included_in_price" ? "included_in_price" : "separate_line",
    };

    const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => {
        setForm((f) => ({ ...f, [k]: e.target.value }));
        setError(null);
    };

    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const fd = new FormData();
        fd.set("code", draft.code);
        fd.set("name", draft.name);
        fd.set("currency", draft.currency);
        fd.set("legalEntityId", draft.legalEntityId);
        fd.set("pricingMode", draft.pricingMode);
        fd.set("dutyPresentation", draft.dutyPresentation);
        setError(null);
        start(async () => {
            // 乐观 setter 必须在 transition 内部调用，写在外面 React 会告警且不与本次 transition 纠缠
            addGhost(draft);
            const r = await createMarketAction(fd);
            if (r.ok) setForm((f) => ({ ...f, code: "", name: "", currency: "" }));
            else setError(r.error);
        });
    }

    const entityName = (id: string) => entities.find((x) => x.id === id)?.displayName ?? id;
    const rows = [...markets, ...ghosts];

    return (
        <>
            {entities.length === 0 ? (
                <p className="mt-4 text-sm text-red-600">还没有法人主体（legal entity），无法新建市场。</p>
            ) : (
                <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
                    <Input value={form.code} onChange={set("code")} placeholder="code 如 gb" required className="py-1.5 text-sm" />
                    <Input value={form.name} onChange={set("name")} placeholder="名称 如 United Kingdom" required className="w-40 py-1.5 text-sm" />
                    <Input value={form.currency} onChange={set("currency")} placeholder="币种 GBP" required className="w-24 py-1.5 text-sm" />
                    <Select value={form.legalEntityId} onChange={set("legalEntityId")} required className="py-1.5 text-sm">
                        {entities.map((en) => (
                            <option key={en.id} value={en.id}>
                                {en.displayName}（{en.jurisdiction}）
                            </option>
                        ))}
                    </Select>
                    <Select value={form.pricingMode} onChange={set("pricingMode")} className="py-1.5 text-sm">
                        <option value="net_plus_tax">net_plus_tax（净价+税）</option>
                        <option value="fixed_gross">fixed_gross（含税全包）</option>
                    </Select>
                    <Select value={form.dutyPresentation} onChange={set("dutyPresentation")} className="py-1.5 text-sm">
                        <option value="separate_line">separate_line（关税单列）</option>
                        <option value="included_in_price">included_in_price（含在价内）</option>
                    </Select>
                    <Button type="submit" size="sm" disabled={pending}>
                        {pending ? "写入中…" : "新增市场"}
                    </Button>
                </form>
            )}

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

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
                        {rows.map((m) => {
                            const isDraft = m.id.startsWith("draft-");
                            return (
                                <Tr key={m.id} className={isDraft ? "opacity-60" : undefined}>
                                    <Td className="font-mono">{m.code}</Td>
                                    <Td>{m.name}</Td>
                                    <Td>{m.currency}</Td>
                                    <Td>{m.pricingMode}</Td>
                                    <Td>{m.dutyPresentation}</Td>
                                    <Td className="text-xs text-muted">
                                        {entityName(m.legalEntityId)}
                                        {isDraft && <span className="ml-2 text-muted">写入中…</span>}
                                    </Td>
                                </Tr>
                            );
                        })}
                    </tbody>
                </table>
            </TableFrame>
        </>
    );
}
