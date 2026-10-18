"use server";

import { revalidatePath } from "next/cache";
import { createDb, createMarket } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";

/** 新建市场（code 唯一；冲突则忽略）。 */
export async function createMarketAction(formData: FormData): Promise<void> {
  const { env } = await requireAdmin();
  const code = String(formData.get("code") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  const legalEntityId = String(formData.get("legalEntityId") ?? "").trim();
  const pricingMode = String(formData.get("pricingMode") ?? "net_plus_tax") === "fixed_gross" ? "fixed_gross" : "net_plus_tax";
  const dutyPresentation =
    String(formData.get("dutyPresentation") ?? "separate_line") === "included_in_price" ? "included_in_price" : "separate_line";

  if (!code || !name || !currency || !legalEntityId) return;

  const db = createDb(env.HYPERDRIVE.connectionString);
  try {
    await createMarket(db, { code, name, currency, legalEntityId, pricingMode, dutyPresentation });
  } catch {
    return; // code 唯一冲突等
  }
  revalidatePath("/markets");
}
