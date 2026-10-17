CREATE TABLE "shipments" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text,
	"carrier_id" uuid,
	"tracking_number" text,
	"label_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"shipped_at" timestamp with time zone,
	"duty_quoted_cents" bigint DEFAULT 0 NOT NULL,
	"duty_actual_cents" bigint,
	"duty_invoice_ref" text,
	"customs_declaration" jsonb
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ship_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ship_tracking_idx" ON "shipments" USING btree ("tracking_number");