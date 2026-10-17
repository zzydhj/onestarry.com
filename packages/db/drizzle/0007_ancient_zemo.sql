CREATE TABLE "transactional_outbox" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "outbox_status_occurred_idx" ON "transactional_outbox" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "transactional_outbox" USING btree ("aggregate_type","aggregate_id");