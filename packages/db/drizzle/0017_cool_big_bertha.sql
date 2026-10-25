DROP INDEX "cn_number_uq";--> statement-breakpoint
DROP INDEX "invoice_number_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "cn_entity_number_uq" ON "credit_notes" USING btree ("legal_entity_id","credit_note_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_entity_number_uq" ON "invoices" USING btree ("legal_entity_id","invoice_number");