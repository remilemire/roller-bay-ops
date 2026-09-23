ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_production_requires_allocated";--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_cut_requires_allocated";--> statement-breakpoint
DROP INDEX "allocations_live_work_order_unique";--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD COLUMN "skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "cancellation_reason" varchar(1000);--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_live_work_order_unique" ON "allocations" USING btree ("work_order_id") WHERE NOT "allocations"."is_draft" AND "allocations"."cancelled_at" IS NULL AND "allocations"."released_at" IS NULL;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_released_completed" CHECK ("allocations"."released_at" IS NULL OR "allocations"."completed_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_skipped_unreviewed" CHECK ("cutting_worksheets"."skipped_at" IS NULL OR ("cutting_worksheets"."reviewed_at" IS NULL AND "cutting_worksheets"."abandoned_at" IS NULL));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cancellation_valid" CHECK (("work_orders"."cancelled_at" IS NULL AND "work_orders"."cancellation_reason" IS NULL) OR ("work_orders"."cancelled_at" IS NOT NULL AND "work_orders"."cancellation_reason" IS NOT NULL AND "work_orders"."allocated_at" IS NULL AND "work_orders"."ship_date" IS NULL AND "work_orders"."shipped_at" IS NULL AND "work_orders"."deleted_at" IS NULL));