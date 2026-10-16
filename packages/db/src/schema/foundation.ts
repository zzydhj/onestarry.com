/**
 * schema/foundation.ts —— 地基表（§15 步骤 4 配置底座 + 步骤 5 钱的结构）
 *
 * 约定：
 * - 全表 UUIDv7 主键（$defaultFn 生成，Workers 兼容，见 ../uuid7）。
 * - provider / status 用 text 而非 enum，保证「加 PSP / 加状态不改结构」（§18）。
 * - 金额一律整数分（*_cents bigint）；比率 numeric。
 * - Drizzle 不能直接表达：GIN(jsonb_path_ops)、ICU COLLATION、只追加表的 GRANT/REVOKE、
 *   分区表。这些在迁移 SQL 里补（见文末「迁移期需手写 SQL」注释）。
 */
import {
    pgTable,
    pgEnum,
    uuid,
    text,
    boolean,
    integer,
    bigint,
    numeric,
    timestamp,
    jsonb,
    index,
    uniqueIndex,
    primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { uuidv7 } from "../uuid7";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const timestamps = () => ({
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/* ------------------------------- 枚举 ------------------------------- */
export const entityScopeEnum = pgEnum("entity_scope", ["country", "region"]);
export const taxDisplayEnum = pgEnum("tax_display", ["inclusive", "exclusive"]);
export const pricingModeEnum = pgEnum("pricing_mode", ["fixed_gross", "net_plus_tax"]);
export const dutyPresentationEnum = pgEnum("duty_presentation", ["separate_line", "included_in_price"]);
export const overThresholdPolicyEnum = pgEnum("over_threshold_policy", ["block", "switch_to_ddp", "ddu_warn"]);
export const fxPolicyEnum = pgEnum("fx_policy", ["manual", "auto_threshold"]);
export const textDirEnum = pgEnum("text_dir", ["ltr", "rtl"]);
export const deMinimisTypeEnum = pgEnum("de_minimis_type", ["vat", "duty"]);
export const ledgerAccountTypeEnum = pgEnum("ledger_account_type", ["asset", "liability", "equity", "revenue", "expense"]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);
export const invoiceKindEnum = pgEnum("invoice_kind", ["invoice", "credit_note"]);

/* --------------------------- 主体 / 支付账号 --------------------------- */
export const legalEntities = pgTable("legal_entities", {
    ...timestamps(),
    id: id(),
    jurisdiction: text("jurisdiction").notNull(), // US / HK / GB / DE ...
    displayName: text("display_name").notNull(),
    taxId: text("tax_id"),
    vatNumber: text("vat_number"),
    functionalCurrency: text("functional_currency").notNull().default("USD"),
    status: text("status").notNull().default("active"),
});

export const paymentProviderAccounts = pgTable(
    "payment_provider_accounts",
    {
        ...timestamps(),
        id: id(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        provider: text("provider").notNull(), // stripe | paypal | airwallex | lianlian | ...（text 可扩展）
        accountRef: text("account_ref"),
        secretRef: text("secret_ref"), // 指向密钥管理，绝不存明文
        status: text("status").notNull().default("pending"), // pending | active | disabled
    },
    (t) => [index("ppa_entity_idx").on(t.legalEntityId), uniqueIndex("ppa_entity_provider_ref_uq").on(t.legalEntityId, t.provider, t.accountRef)],
);

/* ------------------------------ 市场 / 本地化 ------------------------------ */
export const locales = pgTable(
    "locales",
    {
        ...timestamps(),
        id: id(),
        code: text("code").notNull(), // en / de / ar ...
        dir: textDirEnum("dir").notNull().default("ltr"),
        nameOrder: text("name_order").notNull().default("given_first"),
        fontStack: jsonb("font_stack"),
    },
    (t) => [uniqueIndex("locale_code_uq").on(t.code)],
);

export const markets = pgTable(
    "markets",
    {
        ...timestamps(),
        id: id(),
        code: text("code").notNull(), // us | gb | de | eu-rest | gcc ...
        name: text("name").notNull(),
        currency: text("currency").notNull(),
        localeDefault: text("locale_default").notNull().default("en"),
        scope: entityScopeEnum("scope").notNull().default("country"),
        taxDisplay: taxDisplayEnum("tax_display").notNull().default("exclusive"),
        pricingMode: pricingModeEnum("pricing_mode").notNull().default("net_plus_tax"),
        dutyPresentation: dutyPresentationEnum("duty_presentation").notNull().default("separate_line"),
        overThresholdPolicy: overThresholdPolicyEnum("over_threshold_policy").notNull().default("block"),
        fxPolicy: fxPolicyEnum("fx_policy").notNull().default("manual"),
        unitSystem: text("unit_system").notNull().default("metric"),
        timezone: text("timezone").notNull().default("UTC"),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
    },
    (t) => [uniqueIndex("market_code_uq").on(t.code)],
);

export const marketCountries = pgTable(
    "market_countries",
    {
        ...timestamps(),
        id: id(),
        marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
        countryCode: text("country_code").notNull(),
        isDefault: boolean("is_default").notNull().default(false),
        currencyOverride: text("currency_override"), // 非欧元国在 EU 区域市场内可覆盖币种
    },
    (t) => [uniqueIndex("mc_market_country_uq").on(t.marketId, t.countryCode), index("mc_country_idx").on(t.countryCode)],
);

export const marketLocales = pgTable(
    "market_locales",
    {
        ...timestamps(),
        id: id(),
        marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
        localeId: uuid("locale_id").notNull().references(() => locales.id),
    },
    (t) => [uniqueIndex("ml_market_locale_uq").on(t.marketId, t.localeId)],
);

export const deMinimisRules = pgTable(
    "de_minimis_rules",
    {
        ...timestamps(),
        id: id(),
        countryCode: text("country_code").notNull(),
        currency: text("currency").notNull(),
        thresholdCents: bigint("threshold_cents", { mode: "number" }).notNull(),
        type: deMinimisTypeEnum("type").notNull(),
        effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
        effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    },
    (t) => [index("dm_country_type_eff_idx").on(t.countryCode, t.type, t.effectiveFrom)],
);

/* ------------------------------ 税 / 关税 ------------------------------ */
export const taxRegistrations = pgTable(
    "tax_registrations",
    {
        ...timestamps(),
        id: id(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        countryCode: text("country_code").notNull(),
        scheme: text("scheme").notNull(), // IOSS | OSS | UK_VAT | US_NEXUS | ...
        regNumber: text("reg_number"),
        status: text("status").notNull().default("pending"), // pending | active | inactive
        requiresIntermediary: boolean("requires_intermediary").notNull().default(false),
        intermediaryRef: text("intermediary_ref"),
    },
    (t) => [uniqueIndex("tr_entity_country_scheme_uq").on(t.legalEntityId, t.countryCode, t.scheme)],
);

export const taxRatesConfig = pgTable(
    "tax_rates_config",
    {
        ...timestamps(),
        id: id(),
        countryCode: text("country_code").notNull(),
        region: text("region"), // US 州等子辖区
        rate: numeric("rate", { precision: 8, scale: 6 }).notNull(),
        rule: jsonb("rule"),
        effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(), // 不可回溯
        source: text("source").notNull().default("manual_override"), // stripe_tax | manual_override
    },
    (t) => [index("trc_country_eff_idx").on(t.countryCode, t.effectiveFrom)],
);

export const dutyRules = pgTable(
    "duty_rules",
    {
        ...timestamps(),
        id: id(),
        countryCode: text("country_code").notNull(), // ship-to
        hsCode: text("hs_code").notNull(),
        originCountry: text("origin_country"),
        rate: numeric("rate", { precision: 8, scale: 6 }).notNull(),
        rule: jsonb("rule"),
        effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
        source: text("source").notNull().default("manual_override"), // landed_cost | manual_override
    },
    (t) => [index("dr_country_hs_eff_idx").on(t.countryCode, t.hsCode, t.effectiveFrom)],
);

export const marketComplianceProfiles = pgTable(
    "market_compliance_profiles",
    {
        ...timestamps(),
        id: id(),
        marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
        countryCode: text("country_code"), // NULL=市场级；非空=国家覆盖
        requiresEuResponsiblePerson: boolean("requires_eu_responsible_person").notNull().default(false),
        euReprRef: text("eu_repr_ref"),
        ukReprRef: text("uk_repr_ref"),
        gdprArt27Rep: text("gdpr_art27_rep"),
        consentModeV2: boolean("consent_mode_v2").notNull().default(false),
        dataLocalization: boolean("data_localization").notNull().default(false),
        ageVerification: boolean("age_verification").notNull().default(false),
        packagingEpr: jsonb("packaging_epr"), // { WEEE, LUCID, REYDUS ... }
        unitPriceDisplay: boolean("unit_price_display").notNull().default(false), // 德 Grundpreis
        defaultReturnPolicy: text("default_return_policy"),
        prohibitedCategories: jsonb("prohibited_categories"), // 品类 id 数组
    },
    (t) => [uniqueIndex("mcp_market_country_uq").on(t.marketId, t.countryCode)],
);

/* ------------------------------ 运费 / 承运商 ------------------------------ */
export const shippingZones = pgTable("shipping_zones", {
    ...timestamps(),
    id: id(),
    name: text("name").notNull(),
    countryCodes: jsonb("country_codes").notNull(), // ["US","CA","MX"]
});

export const carriers = pgTable("carriers", {
    ...timestamps(),
    id: id(),
    name: text("name").notNull(),
    code: text("code"),
    providerRef: text("provider_ref"), // ShippingProvider 实现标识（中国专线等）
});

export const shippingRates = pgTable(
    "shipping_rates",
    {
        ...timestamps(),
        id: id(),
        zoneId: uuid("zone_id").notNull().references(() => shippingZones.id, { onDelete: "cascade" }),
        carrierId: uuid("carrier_id").references(() => carriers.id),
        currency: text("currency").notNull(),
        rateTable: jsonb("rate_table").notNull(), // 分档/重量表
    },
    (t) => [index("sr_zone_idx").on(t.zoneId)],
);

/* ------------------------------ 法律 / 同意 ------------------------------ */
export const legalDocuments = pgTable(
    "legal_documents",
    {
        ...timestamps(),
        id: id(),
        type: text("type").notNull(), // terms | privacy | returns | withdrawal
        locale: text("locale").notNull(),
        marketId: uuid("market_id").references(() => markets.id),
        version: integer("version").notNull().default(1),
        body: text("body").notNull(),
        isCurrent: boolean("is_current").notNull().default(true),
    },
    (t) => [uniqueIndex("ld_type_locale_market_ver_uq").on(t.type, t.locale, t.marketId, t.version)],
);

export const consents = pgTable(
    "consents",
    {
        ...timestamps(),
        id: id(),
        subjectType: text("subject_type").notNull().default("customer"), // customer | email
        subjectRef: text("subject_ref").notNull(),
        consentType: text("consent_type").notNull(), // marketing | cookies | terms
        granted: boolean("granted").notNull(),
        documentVersion: integer("document_version"),
        source: text("source"),
        ip: text("ip"),
        userAgent: text("user_agent"),
    },
    (t) => [index("consent_subject_type_idx").on(t.subjectRef, t.consentType)],
);

/* ------------------------------ 账本（复式） ------------------------------ */
export const ledgerAccounts = pgTable(
    "ledger_accounts",
    {
        ...timestamps(),
        id: id(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        type: ledgerAccountTypeEnum("type").notNull(),
        name: text("name").notNull(), // psp_clearing | customer_deposits | tax_payable | duty_collected | cogs ...
        code: text("code").notNull(),
        currency: text("currency"),
        jurisdiction: text("jurisdiction"), // tax_payable 按辖区
        providerAccountId: uuid("provider_account_id").references(() => paymentProviderAccounts.id),
        isSystem: boolean("is_system").notNull().default(true),
    },
    (t) => [uniqueIndex("la_entity_code_uq").on(t.legalEntityId, t.code), index("la_entity_type_idx").on(t.legalEntityId, t.type)],
);

export const ledgerTransactions = pgTable(
    "ledger_transactions",
    {
        ...timestamps(),
        id: id(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
        referenceType: text("reference_type").notNull(), // order | payment | refund | shipment | receive | dispute | payout
        referenceId: uuid("reference_id").notNull(),
        memo: text("memo"),
    },
    (t) => [index("lt_entity_posted_idx").on(t.legalEntityId, t.postedAt), index("lt_ref_idx").on(t.referenceType, t.referenceId)],
);

// 只追加表：迁移 SQL 里 REVOKE DELETE / UPDATE ON ledger_entries FROM app_role
export const ledgerEntries = pgTable(
    "ledger_entries",
    {
        ...timestamps(),
        id: id(),
        transactionId: uuid("transaction_id").notNull().references(() => ledgerTransactions.id),
        accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
        direction: ledgerDirectionEnum("direction").notNull(),
        amountFunctional: bigint("amount_functional", { mode: "number" }).notNull(), // 本位币（分）
        amountOriginal: bigint("amount_original", { mode: "number" }).notNull(), // 原币（分）
        currencyOriginal: text("currency_original").notNull(),
        fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull(),
        jurisdiction: text("jurisdiction"),
    },
    (t) => [index("le_transaction_idx").on(t.transactionId), index("le_account_idx").on(t.accountId)],
);

/* ------------------------------ 发票 ------------------------------ */
export const invoiceSequences = pgTable(
    "invoice_sequences",
    {
        ...timestamps(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        kind: invoiceKindEnum("kind").notNull(),
        lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.legalEntityId, t.kind] })],
);

export const invoices = pgTable(
    "invoices",
    {
        ...timestamps(),
        id: id(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        invoiceNumber: text("invoice_number").notNull(), // 由 invoice_sequences 原子取号（支付成功时）
        orderId: uuid("order_id").notNull(), // FK 在 orders.ts 建表后补（避免跨文件前向引用）
        issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
        currency: text("currency").notNull(),
        subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
        taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
        dutyCents: bigint("duty_cents", { mode: "number" }).notNull().default(0),
        shippingCents: bigint("shipping_cents", { mode: "number" }).notNull().default(0),
        totalCents: bigint("total_cents", { mode: "number" }).notNull(),
        taxSnapshot: jsonb("tax_snapshot"), // 下单时税额明细（按辖区/行）
        buyer: jsonb("buyer"), // 抬头/地址快照
        pdfKey: text("pdf_key"), // R2
    },
    (t) => [uniqueIndex("invoice_number_uq").on(t.invoiceNumber), index("invoice_order_idx").on(t.orderId)],
);

export const creditNotes = pgTable(
    "credit_notes",
    {
        ...timestamps(),
        id: id(),
        legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
        creditNoteNumber: text("credit_note_number").notNull(), // 独立序列
        invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
        orderId: uuid("order_id").notNull(),
        issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
        totalCents: bigint("total_cents", { mode: "number" }).notNull(),
        reason: text("reason"),
        pdfKey: text("pdf_key"),
    },
    (t) => [uniqueIndex("cn_number_uq").on(t.creditNoteNumber), index("cn_invoice_idx").on(t.invoiceId)],
);

/* ------------------------------ Relations ------------------------------ */
export const marketsRelations = relations(markets, ({ many, one }) => ({
    legalEntity: one(legalEntities, { fields: [markets.legalEntityId], references: [legalEntities.id] }),
    countries: many(marketCountries),
    locales: many(marketLocales),
    complianceProfiles: many(marketComplianceProfiles),
}));

export const marketCountriesRelations = relations(marketCountries, ({ one }) => ({
    market: one(markets, { fields: [marketCountries.marketId], references: [markets.id] }),
}));

export const ledgerTransactionsRelations = relations(ledgerTransactions, ({ many }) => ({
    entries: many(ledgerEntries),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
    transaction: one(ledgerTransactions, { fields: [ledgerEntries.transactionId], references: [ledgerTransactions.id] }),
    account: one(ledgerAccounts, { fields: [ledgerEntries.accountId], references: [ledgerAccounts.id] }),
}));

export const invoicesRelations = relations(invoices, ({ many }) => ({
    creditNotes: many(creditNotes),
}));

export const creditNotesRelations = relations(creditNotes, ({ one }) => ({
    invoice: one(invoices, { fields: [creditNotes.invoiceId], references: [invoices.id] }),
}));

/* ------------------------- 迁移期需手写 SQL（Drizzle 表达不了） -------------------------
 * 1) 只追加表权限：
 *      REVOKE UPDATE, DELETE ON ledger_entries FROM app_role;
 * 2) 发票取号并发安全：invoice_sequences 用 UPDATE ... RETURNING last_value+1（行锁），
 *    或改用 PG SEQUENCE（每法人一个）；两者皆可，取号必须在「支付成功」事务内。
 * 3) 借贷平衡约束（每组 SUM=0）：应用层 core 校验 + 可选 AFTER INSERT 触发器兜底。
 * 4) 后续 catalog.ts 的 JSONB GIN(jsonb_path_ops)、译文 ICU COLLATION("de-x-icu") 在迁移 SQL 补。
 * --------------------------------------------------------------------------------------- */
