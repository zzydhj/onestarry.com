ALTER TABLE "product_variants" ADD COLUMN "base_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "base_currency" text DEFAULT 'USD' NOT NULL;