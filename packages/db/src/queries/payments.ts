import { and, eq, ne, sql } from "drizzle-orm";
import {
    creditNotes,
    invoiceSequences,
    invoices,
    legalEntities,
    ledgerEntries,
    ledgerTransactions,
    markets,
    orders,
    payments,
    refunds,
} from "../schema";
import { splitReversal, type ReversalSplit } from "@onestarry/core";
import { emitEvent } from "./outbox";
import { requireAccountId } from "./ledger";
import { releaseReservation } from "./inventory";
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

/**
 * 原子取凭证号（行锁 upsert 自增）。EU 连号要求。
 * invoice 与 credit_note 各自一条序列（冲销凭证不能占正式发票的号，否则审计上看不出断号是退的货）。
 */
async function nextDocumentNumber(
    db: Db | Tx,
    legalEntityId: string,
    kind: "invoice" | "credit_note",
    jurisdiction: string,
): Promise<string> {
    const [row] = await db
        .insert(invoiceSequences)
        .values({ legalEntityId, kind, lastValue: 1 })
        .onConflictDoUpdate({
            target: [invoiceSequences.legalEntityId, invoiceSequences.kind],
            set: { lastValue: sql`${invoiceSequences.lastValue} + 1` },
        })
        .returning({ lastValue: invoiceSequences.lastValue });
    const n = row?.lastValue ?? 1;
    const prefix = kind === "credit_note" ? "CN-" : "";
    return `${prefix}${jurisdiction.toUpperCase()}-${String(n).padStart(8, "0")}`;
}

/**
 * 从 market 带出法人与其辖区（发票号前缀是财务凭证语义，不能写死 "XX"）。
 * 正向落账与反向冲销都要它，抽在一处以免两边各自 JOIN 出不一样口径。
 */
async function resolveLegalEntity(db: Db | Tx, marketId: string): Promise<{ legalEntityId: string; jurisdiction: string }> {
    const row = (
        await db
            .select({ legalEntityId: markets.legalEntityId, jurisdiction: legalEntities.jurisdiction })
            .from(markets)
            .innerJoin(legalEntities, eq(legalEntities.id, markets.legalEntityId))
            .where(eq(markets.id, marketId))
            .limit(1)
    )[0];
    if (!row) throw new Error("MARKET_NOT_FOUND");
    return row;
}

/**
 * 支付成功落账（§3.6 两段式·支付段）。接收 Db|Tx，由 webhook 处理器在事务里包。
 * 借 psp_clearing(总额) / 贷 customer_deposits(货+运费净额) + tax_payable + duty_collected，按组校验借贷 SUM=0。
 * 同时：建发票(取连号) + 订单转 paid + 发 payment.succeeded 事件。
 * MVP 假设本位币=订单币种(USD)，amountFunctional=amountOriginal、fx=1；跨币种结算留步骤 12 后续。
 */
export async function recordPaymentSucceeded(db: Db | Tx, input: RecordPaymentInput): Promise<RecordPaymentResult> {
    // 并发孪生于发货 C-1（审查 P1）：换 event_id 的两条成功回调若都无锁读判 paymentStatus，会双双通过下面检查
    // → 双 payment + 双发票 + 双分录。FOR UPDATE 锁订单行串行化（webhook 已将本函数包在事务内）；
    // 末尾转 paid 的条件更新 + payments(order_id) 部分唯一索引作双兜底。
    const order = (await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update"))[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    // 同一订单不得出现两笔“成功支付”：幂等只按 (provider, event_id) 去重，挡不住
    // 换了 event_id 的重复回调 —— 那会多生一份 payment + 一张发票 + 一组分录，账本虚增。
    if (order.paymentStatus === "paid") throw new Error(`PAYMENT_ALREADY_RECORDED:${order.orderNumber}`);

    // 辖区从 market → legalEntity 带出来：发票号前缀是财务凭证语义，不能写死 "XX"。
    const entity = await resolveLegalEntity(db, order.marketId);
    const legalEntityId = entity.legalEntityId;

    const amount = input.amountCents ?? order.totalCents;
    // 金额必须与订单应付额一致：不一致时旧实现会照写不误（借贷平衡校验只能报错，不能防错）。
    // 部分支付本身是合法业务，但本站无 partial 状态位 —— 接了真 PSP 后要拆成独立设计，不能默默记账。
    if (amount !== order.totalCents) throw new Error(`PAYMENT_AMOUNT_MISMATCH:${amount}!=${order.totalCents}`);
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

    const invoiceNumber = await nextDocumentNumber(db, legalEntityId, "invoice", input.jurisdiction ?? entity.jurisdiction);
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

    // 二次兜底（同 C-1）：带 `paymentStatus <> 'paid'` 条件更新 + .returning() 判命中；没命中即抛（整事务回滚）。
    const moved = await db
        .update(orders)
        .set({ status: "paid", paymentStatus: "paid", placedAt: new Date() })
        .where(and(eq(orders.id, order.id), ne(orders.paymentStatus, "paid")))
        .returning({ id: orders.id });
    if (!moved[0]) throw new Error(`PAYMENT_ALREADY_RECORDED:${order.orderNumber}`);

    await emitEvent(db, {
        aggregateType: "payment",
        aggregateId: payment.id,
        eventType: "payment.succeeded",
        payload: { orderId: order.id, invoiceNumber, amountCents: amount },
    });

    return { paymentId: payment.id, invoiceNumber, transactionId: txn.id };
}

/* --------------------------- 反向：钱被收回 / 退掉 --------------------------- */

export interface RecordReversalInput {
    provider: string;
    /**
     * 定位原收款：两个都给了最好，只给一个也能用。
     * 退款类事件常常**不带** `custom_id`（它的 resource 是退款体），所以必须支持只按 captureRef 回溯。
     */
    orderId?: string | null;
    captureRef?: string | null;
    /** revoked = 钱从未到手/又被收回（DENIED / REVERSED）；refunded = 我方退款。 */
    kind: "revoked" | "refunded";
    /** 本次冲销额。revoked 一律按**全额**处理，不看这里（PayPal 给的回撤事件仍携原额）。 */
    amountCents?: number | null;
    /** PSP 侧退款交易号：进 `refunds.provider_ref`，并参与同额重放去重。 */
    refundRef?: string | null;
    reason?: string;
    jurisdiction?: string;
}

export interface RecordReversalResult {
    paymentId: string;
    orderId: string;
    amountCents: number;
    full: boolean;
    paymentStatus: "unpaid" | "refunded" | "partially_refunded";
    transactionId: string;
    /** null = 这单当时就没生过发票（无凭证可冲）。调用方必须记日志，不能静默过去。 */
    creditNoteNumber: string | null;
}

/**
 * 支付反向落账（钱被收回 / 退掉）。与 `recordPaymentSucceeded` **严格对称**：
 * 原那组是「借 psp_clearing / 贷 货+税+关」，这里就是它的红冲。
 *
 * 三条不可省的做法，每条都对应一类真实事故：
 * 1. **只追加分录，不改不删原分录**（`ledger_entries` 已 REVOKE UPDATE/DELETE）—— 审计要看得到完整经过；
 * 2. **金额走 `splitReversal`**，借贷平是构造出来的恒等式，不是指望数据恰好整除；
 * 3. **只改 `payment_status`，不回退 `orders.status`** —— 发货进度不该被支付事件抹掉；
 *    货已寄出而钱被撤回是真业务问题，得人工判（发事件交给 jobs/后台），不该由这里猜。
 */
export async function recordPaymentReversal(db: Db | Tx, input: RecordReversalInput): Promise<RecordReversalResult> {
    const conds = [eq(payments.provider, input.provider)];
    if (input.orderId) conds.push(eq(payments.orderId, input.orderId));
    if (input.captureRef) conds.push(eq(payments.providerRef, input.captureRef));
    // H-1：锁住这笔收款行（FOR UPDATE），把下面的 sum(refunds)/remaining/超额判断全放进锁内。
    //   refund_payment_ref_uq 只挡同一 provider_ref 的重放；两条不同 refundRef 的并发部分退款若不串行化，
    //   会各自读到旧 sum → 双双过 `amount > remaining` → 累计超额退 + 超开红字凭证。
    const rows = await db.select().from(payments).where(and(...conds)).for("update");
    if (rows.length === 0) throw new Error(`PAYMENT_NOT_FOUND:${input.captureRef ?? input.orderId ?? ""}`);
    // 一个单对多笔 capture 本站还没做；真出现时宁可报错也不能挑「第一条」—— 挑错就是冲错钱。
    if (rows.length > 1) throw new Error(`PAYMENT_AMBIGUOUS:${rows.length}`);
    const payment = rows[0]!;

    const order = (await db.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1))[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");

    // 已成功的退款累计（部分退多次的真常见情形）
    const priorRow = await db
        .select({ total: sql<string>`coalesce(sum(${refunds.amountCents}), 0)::bigint` })
        .from(refunds)
        .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "succeeded")));
    const priorCents = Number(priorRow[0]?.total ?? 0);
    const remaining = payment.amountCents - priorCents;

    if (payment.status === "failed") throw new Error(`PAYMENT_ALREADY_REVERSED:${payment.providerRef ?? payment.id}`);

    // 同一笔退款的重复回调（换 event_id 的重放）靠退款号去重。
    // ⚠ 这一块必须排在金额校验**前面**，顺序是有意义的：退完之后再重放，
    // 先算金额会报成「超退」，上层把它当失败一直重试 → 永远投不完的循环；
    // 先报「重复」才能消化成 200，让 PayPal 停下。
    if (input.kind === "refunded" && input.refundRef) {
        const dup = await db
            .select({ id: refunds.id })
            .from(refunds)
            .where(and(eq(refunds.paymentId, payment.id), eq(refunds.providerRef, input.refundRef)))
            .limit(1);
        if (dup[0]) throw new Error(`PAYMENT_ALREADY_REVERSED:${input.refundRef}`);
    }

    // 本次金额：revoked 拿剩余全部（整笔作废），refunded 尊重事件给的额
    const amount = input.kind === "revoked" ? remaining : (input.amountCents ?? remaining);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`REVERSAL_ALREADY_SETTLED:${payment.providerRef ?? payment.id}`);
    if (amount > remaining) throw new Error(`REVERSAL_AMOUNT_OVER:${amount}>${remaining}`);

    const entity = await resolveLegalEntity(db, order.marketId);
    const legalEntityId = entity.legalEntityId;
    const currency = payment.currency;

    // 按原收款构成摊本次冲销额（货+运费 / 税 / 关）；恒等式保证三项之和 == amount
    const base: ReversalSplit = {
        grossCents: order.subtotalCents - order.discountCents + order.shippingCents,
        taxCents: order.taxCents,
        dutyCents: order.dutyCents,
    };
    const share = splitReversal(base, payment.amountCents, amount);

    const [accPsp, accDep, accTax, accDuty] = await Promise.all([
        requireAccountId(db, legalEntityId, "psp_clearing"),
        requireAccountId(db, legalEntityId, "customer_deposits"),
        requireAccountId(db, legalEntityId, "tax_payable"),
        requireAccountId(db, legalEntityId, "duty_collected"),
    ]);

    // 红冲：负债端回去（借），psp_clearing 出去（贷）
    const entries = [
        { accountId: accDep, direction: "debit" as const, amount: share.grossCents },
        { accountId: accTax, direction: "debit" as const, amount: share.taxCents },
        { accountId: accDuty, direction: "debit" as const, amount: share.dutyCents },
        { accountId: accPsp, direction: "credit" as const, amount: amount },
    ].filter((e) => e.amount !== 0);

    const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0);
    const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0);
    if (debit !== credit) throw new Error(`LEDGER_IMBALANCE:${debit}!=${credit}`);

    const [txn] = await db
        .insert(ledgerTransactions)
        .values({
            legalEntityId,
            // referenceType 始终指向「哪笔钱」：referenceId 是 payment.id，与正向那组同一口径。
            // 不写成 refund：那是指向 refunds 表的主键，混了就会让对账脚本找错对象。
            referenceType: "payment",
            referenceId: payment.id,
            memo: `Reversal ${input.kind} ${input.refundRef ?? payment.providerRef ?? ""}`.trim(),
        })
        .returning();
    if (!txn) throw new Error("LEDGER_TXN_FAILED");

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

    const full = priorCents + amount >= payment.amountCents;

    // 退款留台账行（钱确实出去了）；DENIED/REVERSED 不是退款，写进 refunds 会污染财务报表。
    if (input.kind === "refunded") {
        await db.insert(refunds).values({
            paymentId: payment.id,
            orderId: order.id,
            provider: payment.provider,
            providerRef: input.refundRef ?? null,
            amountCents: amount,
            currency,
            reason: input.reason ?? null,
            status: "succeeded",
        });
    }

    // 红字凭证：只有当时生过发票才冲得出去（`credit_notes.invoice_id` 非空）；
    // 没发票就只返回 null，由调用方记日志 —— 钱的事实比凭证重要，不能因为缺凭证就整笔回滚。
    const invoice = (await db.select().from(invoices).where(eq(invoices.orderId, order.id)).limit(1))[0];
    let creditNoteNumber: string | null = null;
    if (invoice) {
        creditNoteNumber = await nextDocumentNumber(db, legalEntityId, "credit_note", input.jurisdiction ?? entity.jurisdiction);
        await db.insert(creditNotes).values({
            legalEntityId,
            creditNoteNumber,
            invoiceId: invoice.id,
            orderId: order.id,
            totalCents: amount,
            reason: input.reason ?? input.kind,
        });
    }

    const paymentStatus = input.kind === "revoked" ? "unpaid" : full ? "refunded" : "partially_refunded";
    await db
        .update(payments)
        .set({ status: input.kind === "revoked" ? "failed" : full ? "refunded" : "succeeded" })
        .where(eq(payments.id, payment.id));

    await db
        .update(orders)
        .set({
            paymentStatus,
            // 撤销不算「退过的钱」（从未真正到手）；退款才累加，否则后台业绩数字会双计。
            ...(input.kind === "refunded" ? { refundedCents: priorCents + amount } : {}),
            // 那张 PayPal 单已作废：清掉它才能让人用一张新单重新付款（不会卡在「已存过单」上）。
            ...(input.kind === "revoked" ? { paypalOrderId: null } : {}),
        })
        .where(eq(orders.id, order.id));

    // H-2：整笔冲销（revoked 或退完 → full）才释放这张单下单时占的预留；部分退款订单仍有效，预留保留。
    // releaseReservation 幂等：若已发货（预留已在 ship 时消耗并置 null）则为空转，不会误回退。
    if (full) await releaseReservation(db, order.id);

    await emitEvent(db, {
        aggregateType: "payment",
        aggregateId: payment.id,
        eventType: input.kind === "revoked" ? "payment.revoked" : "payment.refunded",
        payload: { orderId: order.id, paymentId: payment.id, amountCents: amount, full, creditNoteNumber },
    });

    return { paymentId: payment.id, orderId: order.id, amountCents: amount, full, paymentStatus, transactionId: txn.id, creditNoteNumber };
}
