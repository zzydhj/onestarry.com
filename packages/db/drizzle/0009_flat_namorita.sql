CREATE TABLE "disputes" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid,
	"order_id" uuid,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence_due_at" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"provider_ref" text,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"fee_currency" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"captured_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" uuid,
	"provider_ref" text,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"arrival_date" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_account_id_payment_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."payment_provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_account_id_payment_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."payment_provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_provider_ref_uq" ON "disputes" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "dispute_order_idx" ON "disputes" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_provider_ref_uq" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "pay_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_provider_ref_uq" ON "payouts" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "refund_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refund_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wh_provider_event_uq" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "wh_status_idx" ON "webhook_events" USING btree ("status");