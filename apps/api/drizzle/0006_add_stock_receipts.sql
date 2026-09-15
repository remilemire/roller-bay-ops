CREATE TABLE "stock_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_receipt_id" uuid NOT NULL,
	"fabric_color_id" uuid NOT NULL,
	"width_mm" numeric(12, 3) NOT NULL,
	"initial_length_mm" numeric(12, 3) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"location_id" uuid NOT NULL,
	CONSTRAINT "stock_receipt_items_width_mm_positive" CHECK ("stock_receipt_items"."width_mm" > 0 AND "stock_receipt_items"."width_mm" <> 'NaN'::numeric),
	CONSTRAINT "stock_receipt_items_initial_length_mm_positive" CHECK ("stock_receipt_items"."initial_length_mm" > 0 AND "stock_receipt_items"."initial_length_mm" <> 'NaN'::numeric),
	CONSTRAINT "stock_receipt_items_quantity_positive" CHECK ("stock_receipt_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_number" varchar(50) NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_receipts_purchase_order_number_format" CHECK (length("stock_receipts"."purchase_order_number") > 0 AND "stock_receipts"."purchase_order_number" !~ '^[[:space:]]|[[:space:]]$')
);
--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD COLUMN "stock_receipt_item_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_stock_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("stock_receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_fabric_color_id_fabric_colors_id_fk" FOREIGN KEY ("fabric_color_id") REFERENCES "public"."fabric_colors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_receipt_items_stock_receipt_id_idx" ON "stock_receipt_items" USING btree ("stock_receipt_id");--> statement-breakpoint
CREATE INDEX "stock_receipt_items_fabric_color_id_idx" ON "stock_receipt_items" USING btree ("fabric_color_id");--> statement-breakpoint
CREATE INDEX "stock_receipt_items_location_id_idx" ON "stock_receipt_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_receipts_purchase_order_number_idx" ON "stock_receipts" USING btree ("purchase_order_number");--> statement-breakpoint
CREATE INDEX "stock_receipts_submitted_by_user_id_idx" ON "stock_receipts" USING btree ("submitted_by_user_id");--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_stock_receipt_item_id_stock_receipt_items_id_fk" FOREIGN KEY ("stock_receipt_item_id") REFERENCES "public"."stock_receipt_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fabric_stock_items_stock_receipt_item_id_idx" ON "fabric_stock_items" USING btree ("stock_receipt_item_id");