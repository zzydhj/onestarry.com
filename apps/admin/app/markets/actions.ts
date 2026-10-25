"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@onestarry/core";
import { createMarket } from "@onestarry/db";
import { getRequestDb } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

export type MarketCreateResult = { ok: true } | { ok: false; error: string };

/**
 * 新建市场（code 唯一）。需 market:write（staff 无此权）。
 *
 * 为什么要返回值：旧写法 `catch { return }` 把 code 冲突整个吞掉，运营点"新增市场"后
 * 表格什么都不出现、也没有任何提示 —— 只能反复试或以为系统坏了。市场页现在是乐观 UI
 * （先挂假行），失败必须说出来，不然假行无声消失更像"没点上"。
 */
export async function createMarketAction(formData: FormData): Promise<MarketCreateResult> {
    const { env } = await requirePermission(PERMISSIONS.marketWrite);
    const code = String(formData.get("code") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
    const legalEntityId = String(formData.get("legalEntityId") ?? "").trim();
    const pricingMode = String(formData.get("pricingMode") ?? "net_plus_tax") === "fixed_gross" ? "fixed_gross" : "net_plus_tax";
    const dutyPresentation =
        String(formData.get("dutyPresentation") ?? "separate_line") === "included_in_price" ? "included_in_price" : "separate_line";

    if (!code || !name || !currency || !legalEntityId) return { ok: false, error: "code / 名称 / 币种 / 法人 都必填" };

    const db = getRequestDb(env.HYPERDRIVE.connectionString);
    try {
        await createMarket(db, { code, name, currency, legalEntityId, pricingMode, dutyPresentation });
    } catch (e) {
        // 23505 = unique_violation：markets.code 上有唯一索引
        const dup = (e as { code?: string }).code === "23505";
        return { ok: false, error: dup ? `code「${code}」已存在` : e instanceof Error ? e.message : "创建失败" };
    }
    revalidatePath("/markets");
    return { ok: true };
}
