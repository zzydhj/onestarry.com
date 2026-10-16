CREATE TYPE "public"."de_minimis_type" AS ENUM('vat', 'duty');--> statement-breakpoint
CREATE TYPE "public"."duty_presentation" AS ENUM('separate_line', 'included_in_price');--> statement-breakpoint
CREATE TYPE "public"."entity_scope" AS ENUM('country', 'region');--> statement-breakpoint
CREATE TYPE "public"."fx_policy" AS ENUM('manual', 'auto_threshold');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."over_threshold_policy" AS ENUM('block', 'switch_to_ddp', 'ddu_warn');--> statement-breakpoint
CREATE TYPE "public"."pricing_mode" AS ENUM('fixed_gross', 'net_plus_tax');--> statement-breakpoint
CREATE TYPE "public"."tax_display" AS ENUM('inclusive', 'exclusive');--> statement-breakpoint
CREATE TYPE "public"."text_dir" AS ENUM('ltr', 'rtl');--> statement-breakpoint
CREATE TABLE "carriers" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"provider_ref" text
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text DEFAULT 'customer' NOT NULL,
	"subject_ref" text NOT NULL,
	"consent_type" text NOT NULL,
	"granted" boolean NOT NULL,
	"document_version" integer,
	"source" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"credit_note_number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_cents" bigint NOT NULL,
	"reason" text,
	"pdf_key" text
);
--> statement-breakpoint
CREATE TABLE "de_minimis_rules" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"currency" text NOT NULL,
	"threshold_cents" bigint NOT NULL,
	"type" "de_minimis_type" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "duty_rules" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"hs_code" text NOT NULL,
	"origin_country" text,
	"rate" numeric(8, 6) NOT NULL,
	"rule" jsonb,
	"effective_from" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual_override' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"last_value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_sequences_legal_entity_id_kind_pk" PRIMARY KEY("legal_entity_id","kind")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"duty_cents" bigint DEFAULT 0 NOT NULL,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"tax_snapshot" jsonb,
	"buyer" jsonb,
	"pdf_key" text
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"currency" text,
	"jurisdiction" text,
	"provider_account_id" uuid,
	"is_system" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_functional" bigint NOT NULL,
	"amount_original" bigint NOT NULL,
	"currency_original" text NOT NULL,
	"fx_rate" numeric(18, 8) NOT NULL,
	"jurisdiction" text
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"locale" text NOT NULL,
	"market_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"display_name" text NOT NULL,
	"tax_id" text,
	"vat_number" text,
	"functional_currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locales" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"dir" text_dir DEFAULT 'ltr' NOT NULL,
	"name_order" text DEFAULT 'given_first' NOT NULL,
	"font_stack" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_compliance_profiles" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"country_code" text,
	"requires_eu_responsible_person" boolean DEFAULT false NOT NULL,
	"eu_repr_ref" text,
	"uk_repr_ref" text,
	"gdpr_art27_rep" text,
	"consent_mode_v2" boolean DEFAULT false NOT NULL,
	"data_localization" boolean DEFAULT false NOT NULL,
	"age_verification" boolean DEFAULT false NOT NULL,
	"packaging_epr" jsonb,
	"unit_price_display" boolean DEFAULT false NOT NULL,
	"default_return_policy" text,
	"prohibited_categories" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_countries" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"currency_override" text
);
--> statement-breakpoint
CREATE TABLE "market_locales" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"locale_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"locale_default" text DEFAULT 'en' NOT NULL,
	"scope" "entity_scope" DEFAULT 'country' NOT NULL,
	"tax_display" "tax_display" DEFAULT 'exclusive' NOT NULL,
	"pricing_mode" "pricing_mode" DEFAULT 'net_plus_tax' NOT NULL,
	"duty_presentation" "duty_presentation" DEFAULT 'separate_line' NOT NULL,
	"over_threshold_policy" "over_threshold_policy" DEFAULT 'block' NOT NULL,
	"fx_policy" "fx_policy" DEFAULT 'manual' NOT NULL,
	"unit_system" text DEFAULT 'metric' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"legal_entity_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_provider_accounts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_ref" text,
	"secret_ref" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"carrier_id" uuid,
	"currency" text NOT NULL,
	"rate_table" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country_codes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rates_config" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"region" text,
	"rate" numeric(8, 6) NOT NULL,
	"rule" jsonb,
	"effective_from" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual_override' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_registrations" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"scheme" text NOT NULL,
	"reg_number" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requires_intermediary" boolean DEFAULT false NOT NULL,
	"intermediary_ref" text
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_provider_account_id_payment_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."payment_provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_compliance_profiles" ADD CONSTRAINT "market_compliance_profiles_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_countries" ADD CONSTRAINT "market_countries_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_locales" ADD CONSTRAINT "market_locales_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_locales" ADD CONSTRAINT "market_locales_locale_id_locales_id_fk" FOREIGN KEY ("locale_id") REFERENCES "public"."locales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_accounts" ADD CONSTRAINT "payment_provider_accounts_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_subject_type_idx" ON "consents" USING btree ("subject_ref","consent_type");--> statement-breakpoint
CREATE UNIQUE INDEX "cn_number_uq" ON "credit_notes" USING btree ("credit_note_number");--> statement-breakpoint
CREATE INDEX "cn_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "dm_country_type_eff_idx" ON "de_minimis_rules" USING btree ("country_code","type","effective_from");--> statement-breakpoint
CREATE INDEX "dr_country_hs_eff_idx" ON "duty_rules" USING btree ("country_code","hs_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_uq" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoice_order_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "la_entity_code_uq" ON "ledger_accounts" USING btree ("legal_entity_id","code");--> statement-breakpoint
CREATE INDEX "la_entity_type_idx" ON "ledger_accounts" USING btree ("legal_entity_id","type");--> statement-breakpoint
CREATE INDEX "le_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "le_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "lt_entity_posted_idx" ON "ledger_transactions" USING btree ("legal_entity_id","posted_at");--> statement-breakpoint
CREATE INDEX "lt_ref_idx" ON "ledger_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ld_type_locale_market_ver_uq" ON "legal_documents" USING btree ("type","locale","market_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "locale_code_uq" ON "locales" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_market_country_uq" ON "market_compliance_profiles" USING btree ("market_id","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "mc_market_country_uq" ON "market_countries" USING btree ("market_id","country_code");--> statement-breakpoint
CREATE INDEX "mc_country_idx" ON "market_countries" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ml_market_locale_uq" ON "market_locales" USING btree ("market_id","locale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_code_uq" ON "markets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ppa_entity_idx" ON "payment_provider_accounts" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppa_entity_provider_ref_uq" ON "payment_provider_accounts" USING btree ("legal_entity_id","provider","account_ref");--> statement-breakpoint
CREATE INDEX "sr_zone_idx" ON "shipping_rates" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "trc_country_eff_idx" ON "tax_rates_config" USING btree ("country_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tr_entity_country_scheme_uq" ON "tax_registrations" USING btree ("legal_entity_id","country_code","scheme");