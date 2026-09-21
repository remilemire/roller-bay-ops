-- An order now exists before it has a ship date, and gets one only once fabric
-- is allocated. scheduled_at stops doubling as the creation time.
ALTER TABLE "public"."work_orders" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
UPDATE "public"."work_orders" SET "created_at" = "scheduled_at";--> statement-breakpoint
ALTER TABLE "public"."work_orders" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "public"."work_orders" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."work_orders" ALTER COLUMN "ship_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."work_orders" ALTER COLUMN "scheduled_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."work_orders" ALTER COLUMN "scheduled_at" DROP NOT NULL;--> statement-breakpoint
-- Dates given before any fabric was allocated cannot stand under the new rule.
-- They are discarded, not moved: the order is dated again once it is allocated.
UPDATE "public"."work_orders" SET "ship_date" = NULL, "scheduled_at" = NULL WHERE "allocated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "public"."work_orders" ADD CONSTRAINT "work_orders_ship_date_requires_allocation" CHECK ("work_orders"."ship_date" IS NULL OR "work_orders"."allocated_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "public"."work_orders" ADD CONSTRAINT "work_orders_scheduled_at_matches_ship_date" CHECK (("work_orders"."ship_date" IS NULL) = ("work_orders"."scheduled_at" IS NULL));--> statement-breakpoint
-- 'order.scheduled' used to mean the order was created; it now means it was
-- given a ship date, so earlier events take the name they would have today.
UPDATE "public"."audit_events" SET "action" = 'order.created' WHERE "action" = 'order.scheduled';
