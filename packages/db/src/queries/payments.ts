import { and, eq, sql } from "drizzle-orm";
import {
    invoiceSequences,
    invoices,
    ledgerEntries,
    ledgerTransactions,
    markets,
    orders,
    payments,
} from "../schema";
import { emitEvent } from "./outbox";
import { requireAccountId } from "./ledger";
import type { Db, Tx } from "../client";

export interface RecordPaymentInput {
    orderId: string;
    provider: string;
    providerRef?: string;
    /** 实际收款分；默认取订单 totalCents。 */
    amountCents?: number;
    /** 发票号前缀（法人辖区）；默认 "XX"。 */
    jurisdiction?: string;
}

export interface RecordPaymentResult {
    paymentId: string;
    invoiceNumber: string;
    transactionId: string;
}

/** 原子取发票号（行锁 upsert 自增）。EU 连号要求。 */
async function nextInvoiceNumber(db: Db | Tx, legalEntityId: string, jurisdiction: string): Promise<string> {
    const [row] = await db
        .insert(invoiceSequences)
        .values({ legalEntityId, kind: "invoice", lastValue: 1 })
        .onConflictDoUpdate({
            target: [invoiceSequences.legalEntityId, invoiceSequences.kind],
            set: { lastValue: sql`${invoiceSequences.lastValue} + 1` },
        })
        .returning({ lastValue: invoiceSequences.lastValue });
    const n = row?.lastValue ?? 1;
    return `${jurisdiction.toUpperCase()}-${String(n).padStart(8, "0")}`;
}

/**
 * 支付成功落账（§3.6 两段式·支付段）。接收 Db|Tx，由 webhook 处理器在事务里包。
 * 借 psp_clearing(总额) / 贷 customer_deposits(货+运费净额) + tax_payable + duty_collected，按组校验借贷 SUM=0。
 * 同时：建发票(取连号) + 订单转 paid + 发 payment.succeeded 事件。
 * MVP 假设本位币=订单币种(USD)，amountFunctional=amountOriginal、fx=1；跨币种结算留步骤 12 后续。
 */
export async function recordPaymentSucceeded(db: Db | Tx, input: RecordPaymentInput): Promise<RecordPaymentResult> {
    const order = (await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1))[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");

    const market = (
        await db.select({ legalEntityId: markets.legalEntityId }).from(markets).where(eq(markets.id, order.marketId)).limit(1)
    )[0];
    if (!market) throw new Error("MARKET_NOT_FOUND");
    const legalEntityId = market.legalEntityId;

    const amount = input.amountCents ?? order.totalCents;
    const currency = order.currency;

    const [accPsp, accDep, accTax, accDuty] = await Promise.all([
        requireAccountId(db, legalEntityId, "psp_clearing"),
        requireAccountId(db, legalEntityId, "customer_deposits"),
        requireAccountId(db, legalEntityId, "tax_payable"),
        requireAccountId(db, legalEntityId, "duty_collected"),
    ]);

    const [payment] = await db
        .insert(payments)
        .values({
            orderId: order.id,
            provider: input.provider,
            providerRef: input.providerRef,
            amountCents: amount,
            currency,
            status: "succeeded",
            capturedAt: new Date(),
        })
        .returning();
    if (!payment) throw new Error("PAYMENT_INSERT_FAILED");

    const [txn] = await db
        .insert(ledgerTransactions)
        .values({ legalEntityId, referenceType: "payment", referenceId: payment.id, memo: `Payment ${input.providerRef ?? ""}` })
        .returning();
    if (!txn) throw new Error("LEDGER_TXN_FAILED");

    const goodsPlusShipping = order.subtotalCents - order.discountCents + order.shippingCents;
    const entries = [
        { accountId: accPsp, direction: "debit" as const, amount: amount },
        { accountId: accDep, direction: "credit" as const, amount: goodsPlusShipping },
        { accountId: accTax, direction: "credit" as const, amount: order.taxCents },
        { accountId: accDuty, direction: "credit" as const, amount: order.dutyCents },
    ].filter((e) => e.amount !== 0);

    // 借贷平衡校验（不平时整笔回滚）
    const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0);
    const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0);
    if (debit !== credit) throw new Error(`LEDGER_IMBALANCE:${debit}!=${credit}`);

    await db.insert(ledgerEntries).values(
        entries.map((e) => ({
            transactionId: txn.id,
            accountId: e.accountId,
            direction: e.direction,
            amountFunctional: e.amount,
            amountOriginal: e.amount,
            currencyOriginal: currency,
            fxRate: "1",
        })),
    );

    const invoiceNumber = await nextInvoiceNumber(db, legalEntityId, input.jurisdiction ?? "XX");
    await db.insert(invoices).values({
        legalEntityId,
        invoiceNumber,
        orderId: order.id,
        currency,
        subtotalCents: order.subtotalCents,
        taxCents: order.taxCents,
        dutyCents: order.dutyCents,
        shippingCents: order.shippingCents,
        totalCents: order.totalCents,
    });

    await db.update(orders).set({ status: "paid", paymentStatus: "paid", placedAt: new Date() }).where(eq(orders.id, order.id));

    await emitEvent(db, {
        aggregateType: "payment",
        aggregateId: payment.id,
        eventType: "payment.succeeded",
        payload: { orderId: order.id, invoiceNumber, amountCents: amount },
    });

    return { paymentId: payment.id, invoiceNumber, transactionId: txn.id };
}
