ALTER TABLE "order_items" ADD CONSTRAINT "oi_quantity_range" CHECK ("order_items"."quantity" > 0 AND "order_items"."quantity" <= 10000);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_total_nonneg" CHECK ("orders"."total_cents" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_discount_nonneg" CHECK ("orders"."discount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_amount_nonneg" CHECK ("payments"."amount_cents" >= 0);