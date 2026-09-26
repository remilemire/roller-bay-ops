ALTER TABLE "work_orders" ADD COLUMN "back_order_purchase_order_number" varchar(5);--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "back_order_arrival_date" date;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_back_order_complete" CHECK (("work_orders"."back_order_purchase_order_number" IS NULL) = ("work_orders"."back_order_arrival_date" IS NULL));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_back_order_purchase_order_number_format" CHECK ("work_orders"."back_order_purchase_order_number" ~ '^[0-9]{5}$');