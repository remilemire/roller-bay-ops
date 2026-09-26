CREATE TABLE "work_order_purchase_orders" (
	"work_order_id" uuid NOT NULL,
	"purchase_order_number" varchar(5) NOT NULL,
	CONSTRAINT "work_order_purchase_orders_work_order_id_purchase_order_number_pk" PRIMARY KEY("work_order_id","purchase_order_number"),
	CONSTRAINT "work_order_purchase_orders_number_format" CHECK ("work_order_purchase_orders"."purchase_order_number" ~ '^[0-9]{5}$')
);
--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_back_order_complete";--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_back_order_purchase_order_number_format";--> statement-breakpoint
ALTER TABLE "work_order_purchase_orders" ADD CONSTRAINT "work_order_purchase_orders_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing back orders keep their purchase order; the due date is dropped.
INSERT INTO "work_order_purchase_orders" ("work_order_id", "purchase_order_number")
SELECT "id", "back_order_purchase_order_number" FROM "work_orders"
WHERE "back_order_purchase_order_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "back_order_purchase_order_number";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "back_order_arrival_date";