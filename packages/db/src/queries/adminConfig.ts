import { asc } from "drizzle-orm";
import { legalEntities, markets } from "../schema";
import type { Db, Tx } from "../client";

/** 市场列表（后台配置页用）。 */
export async function listMarkets(db: Db | Tx) {
    return db
        .select({
            id: markets.id,
            code: markets.code,
            name: markets.name,
            currency: markets.currency,
            pricingMode: markets.pricingMode,
            dutyPresentation: markets.dutyPresentation,
            taxDisplay: markets.taxDisplay,
            overThresholdPolicy: markets.overThresholdPolicy,
            legalEntityId: markets.legalEntityId,
        })
        .from(markets)
        .orderBy(asc(markets.code));
}

/** 法人列表（新建市场时选主体）。 */
export async function listLegalEntities(db: Db | Tx) {
    return db
        .select({ id: legalEntities.id, displayName: legalEntities.displayName, jurisdiction: legalEntities.jurisdiction })
        .from(legalEntities)
        .orderBy(asc(legalEntities.displayName));
}

export interface CreateMarketInput {
    code: string;
    name: string;
    currency: string;
    legalEntityId: string;
    pricingMode: "fixed_gross" | "net_plus_tax";
    dutyPresentation: "separate_line" | "included_in_price";
    taxDisplay?: "inclusive" | "exclusive";
    overThresholdPolicy?: "block" | "switch_to_ddp" | "ddu_warn";
}

/** 新建市场。 */
export async function createMarket(db: Db | Tx, input: CreateMarketInput): Promise<{ id: string }> {
    const [row] = await db
        .insert(markets)
        .values({
            code: input.code,
            name: input.name,
            currency: input.currency,
            legalEntityId: input.legalEntityId,
            pricingMode: input.pricingMode,
            dutyPresentation: input.dutyPresentation,
            taxDisplay: input.taxDisplay ?? "exclusive",
            overThresholdPolicy: input.overThresholdPolicy ?? "block",
        })
        .returning({ id: markets.id });
    return { id: row!.id };
}
