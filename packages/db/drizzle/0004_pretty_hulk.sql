CREATE TYPE "public"."stock_movement_type" AS ENUM('sale', 'return', 'adjustment', 'receive', 'damage');--> statement-breakpoint
CREATE TABLE "inventory" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"available" integer GENERATED ALWAYS AS (("on_hand" - "reserved")) STORED
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"on_hand_after" integer,
	"unit_cost_cents" bigint,
	"reference_type" text,
	"reference_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sm_variant_idx" ON "stock_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "sm_ref_idx" ON "stock_movements" USING btree ("reference_type","reference_id");