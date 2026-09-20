-- Orders scheduled before quantities existed take a placeholder of 1, to be
-- corrected by hand; the default is dropped so new orders must state theirs.
ALTER TABLE "scheduled_orders" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_orders" ALTER COLUMN "quantity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scheduled_orders" ADD CONSTRAINT "scheduled_orders_quantity_positive" CHECK ("scheduled_orders"."quantity" > 0);