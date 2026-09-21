-- The order, not its ship date, is the record: the schedule becomes one view of
-- work orders. Renames only; no row changes except the audit record type, which
-- is also the path of the record's history and detail URLs.
ALTER TABLE "public"."scheduled_orders" RENAME TO "work_orders";--> statement-breakpoint
ALTER INDEX "public"."scheduled_orders_pkey" RENAME TO "work_orders_pkey";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_order_number_unique" TO "work_orders_order_number_unique";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_order_number_format" TO "work_orders_order_number_format";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_ship_date_weekday" TO "work_orders_ship_date_weekday";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_quantity_positive" TO "work_orders_quantity_positive";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_revision_positive" TO "work_orders_revision_positive";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_deleted_unallocated" TO "work_orders_deleted_unallocated";--> statement-breakpoint
ALTER TABLE "public"."work_orders" RENAME CONSTRAINT "scheduled_orders_cut_requires_allocated" TO "work_orders_cut_requires_allocated";--> statement-breakpoint
ALTER TABLE "public"."allocations" RENAME CONSTRAINT "allocations_order_number_scheduled_orders_order_number_fk" TO "allocations_order_number_work_orders_order_number_fk";--> statement-breakpoint
UPDATE "public"."audit_changes"
SET "record_type" = 'work-orders',
    "before" = CASE WHEN "before" IS NULL THEN NULL ELSE jsonb_set("before", '{type}', '"work-orders"') END,
    "after" = CASE WHEN "after" IS NULL THEN NULL ELSE jsonb_set("after", '{type}', '"work-orders"') END
WHERE "record_type" = 'order-schedule';
