CREATE TYPE "public"."price_change_reason" AS ENUM('manual', 'promotion', 'duty_recalc', 'fx_recalc');--> statement-breakpoint
CREATE TABLE "price_history" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"old_list_price_cents" bigint NOT NULL,
	"new_list_price_cents" bigint NOT NULL,
	"reason" "price_change_reason" NOT NULL,
	"changed_by" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "variant_market_prices" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"goods_cents" bigint NOT NULL,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"duty_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"list_price_cents" bigint NOT NULL,
	"all_in_cents" bigint NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"pricing_mode" "pricing_mode" NOT NULL,
	"duty_presentation" "duty_presentation" NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"inputs_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_market_prices" ADD CONSTRAINT "variant_market_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_market_prices" ADD CONSTRAINT "variant_market_prices_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ph_variant_market_time_idx" ON "price_history" USING btree ("variant_id","market_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "vmp_variant_market_uq" ON "variant_market_prices" USING btree ("variant_id","market_id");--> statement-breakpoint
CREATE INDEX "vmp_market_idx" ON "variant_market_prices" USING btree ("market_id");