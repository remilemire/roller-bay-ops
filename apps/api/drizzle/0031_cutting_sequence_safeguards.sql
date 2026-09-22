DROP INDEX "cutting_worksheets_allocation_unique";--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD COLUMN "sequence" serial NOT NULL;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "cutting_worksheets_allocation_unique" ON "cutting_worksheets" USING btree ("allocation_id") WHERE "cutting_worksheets"."abandoned_at" IS NULL;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_revision_positive" CHECK ("cutting_worksheets"."revision">0);--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_review_requires_submission" CHECK ("cutting_worksheets"."reviewed_at" IS NULL OR "cutting_worksheets"."submitted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_station_valid" CHECK ("production_completions"."station" IN ('cutting','assembly','checking','shipping'));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_production_requires_allocated" CHECK (("work_orders"."assembled_at" IS NULL AND "work_orders"."checked_at" IS NULL) OR "work_orders"."allocated_at" IS NOT NULL);