import { and, eq } from "drizzle-orm";
import { ledgerAccounts } from "../schema";
import type { Db, Tx } from "../client";

/** 标准复式账本科目（每法人一套；§3.6）。加科目只改这张清单，不改结构。 */
export const STANDARD_LEDGER_ACCOUNTS: {
    code: string;
    type: "asset" | "liability" | "equity" | "revenue" | "expense";
    name: string;
}[] = [
        { code: "psp_clearing", type: "asset", name: "PSP Clearing" },
        { code: "bank", type: "asset", name: "Bank" },
        { code: "inventory_asset", type: "asset", name: "Inventory" },
        { code: "customer_deposits", type: "liability", name: "Customer Deposits" },
        { code: "tax_payable", type: "liability", name: "Tax Payable" },
        { code: "duty_collected", type: "liability", name: "Duty Collected" },
        { code: "carrier_payable", type: "liability", name: "Carrier Payable" },
        { code: "external_ap_clearing", type: "liability", name: "External AP Clearing" }, // 入库：借 inventory_asset / 贷此（§13）
        { code: "revenue", type: "revenue", name: "Revenue" },
        { code: "shipping_revenue", type: "revenue", name: "Shipping Revenue" },
        { code: "cogs", type: "expense", name: "COGS" },
        { code: "duty_expense", type: "expense", name: "Duty Expense" },
        { code: "psp_fees", type: "expense", name: "PSP Fees" },
    ];

/** 幂等 seed：已存在的 (legalEntityId, code) 跳过。 */
export async function seedLedgerAccounts(db: Db | Tx, legalEntityId: string): Promise<void> {
    await db
        .insert(ledgerAccounts)
        .values(
            STANDARD_LEDGER_ACCOUNTS.map((a) => ({
                legalEntityId,
                code: a.code,
                type: a.type,
                name: a.name,
                isSystem: true,
            })),
        )
        .onConflictDoNothing();
}

/** 取某法人某科目 id，缺失即报错（落账前必须已 seed）。 */
export async function requireAccountId(db: Db | Tx, legalEntityId: string, code: string): Promise<string> {
    const [a] = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.legalEntityId, legalEntityId), eq(ledgerAccounts.code, code)))
        .limit(1);
    if (!a) throw new Error(`LEDGER_ACCOUNT_MISSING:${code}`);
    return a.id;
}
