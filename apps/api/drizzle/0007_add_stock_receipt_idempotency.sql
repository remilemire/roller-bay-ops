ALTER TABLE "stock_receipts" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "request_hash" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipts_submitter_key_unique" ON "stock_receipts" USING btree ("submitted_by_user_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_idempotency_pair" CHECK (
      ("stock_receipts"."idempotency_key" IS NULL AND "stock_receipts"."request_hash" IS NULL) OR
      ("stock_receipts"."idempotency_key" IS NOT NULL AND "stock_receipts"."request_hash" IS NOT NULL AND "stock_receipts"."request_hash" ~ '^[0-9a-f]{64}$')
    );