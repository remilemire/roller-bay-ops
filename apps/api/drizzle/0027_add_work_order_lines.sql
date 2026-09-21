CREATE TABLE "work_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"fabric_color_id" uuid NOT NULL,
	"width_mm" numeric(12, 3) NOT NULL,
	"length_mm" numeric(12, 3) NOT NULL,
	"quantity" integer NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "work_order_lines_position_positive" CHECK ("work_order_lines"."position" > 0),
	CONSTRAINT "work_order_lines_width_mm_positive" CHECK ("work_order_lines"."width_mm" > 0),
	CONSTRAINT "work_order_lines_length_mm_positive" CHECK ("work_order_lines"."length_mm" > 0),
	CONSTRAINT "work_order_lines_quantity_positive" CHECK ("work_order_lines"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_fabric_color_id_fabric_colors_id_fk" FOREIGN KEY ("fabric_color_id") REFERENCES "public"."fabric_colors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_lines_work_order_id_position_idx" ON "work_order_lines" USING btree ("work_order_id","position");--> statement-breakpoint
CREATE INDEX "work_order_lines_fabric_color_id_idx" ON "work_order_lines" USING btree ("fabric_color_id");