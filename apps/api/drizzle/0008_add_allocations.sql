CREATE TABLE "allocation_cut_items" (
	"allocation_cut_id" uuid NOT NULL,
	"allocation_requirement_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "allocation_cut_items_allocation_cut_id_allocation_requirement_id_pk" PRIMARY KEY("allocation_cut_id","allocation_requirement_id"),
	CONSTRAINT "allocation_cut_items_position_positive" CHECK ("allocation_cut_items"."position" > 0),
	CONSTRAINT "allocation_cut_items_quantity_positive" CHECK ("allocation_cut_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "allocation_cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"planned_length_mm" numeric(12, 3) NOT NULL,
	"edge_trim_mm" numeric(12, 3) NOT NULL,
	CONSTRAINT "allocation_cuts_position_positive" CHECK ("allocation_cuts"."position" > 0),
	CONSTRAINT "allocation_cuts_planned_length_mm_positive" CHECK ("allocation_cuts"."planned_length_mm" > 0 AND "allocation_cuts"."planned_length_mm" <> 'NaN'::numeric),
	CONSTRAINT "allocation_cuts_edge_trim_mm_positive" CHECK ("allocation_cuts"."edge_trim_mm" > 0 AND "allocation_cuts"."edge_trim_mm" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "allocation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"reserved_length_mm" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_items_reserved_length_mm_positive" CHECK ("allocation_items"."reserved_length_mm" > 0 AND "allocation_items"."reserved_length_mm" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "allocation_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"fabric_color_id" uuid NOT NULL,
	"width_mm" numeric(12, 3) NOT NULL,
	"length_mm" numeric(12, 3) NOT NULL,
	"length_allowance_mm" numeric(12, 3) DEFAULT '0' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "allocation_requirements_width_mm_positive" CHECK ("allocation_requirements"."width_mm" > 0 AND "allocation_requirements"."width_mm" <> 'NaN'::numeric),
	CONSTRAINT "allocation_requirements_length_mm_positive" CHECK ("allocation_requirements"."length_mm" > 0 AND "allocation_requirements"."length_mm" <> 'NaN'::numeric),
	CONSTRAINT "allocation_requirements_length_allowance_mm_nonnegative" CHECK ("allocation_requirements"."length_allowance_mm" >= 0 AND "allocation_requirements"."length_allowance_mm" <> 'NaN'::numeric),
	CONSTRAINT "allocation_requirements_quantity_positive" CHECK ("allocation_requirements"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(50) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "allocations_order_number_format" CHECK (length("allocations"."order_number") > 0 AND "allocations"."order_number" !~ '^[[:space:]]|[[:space:]]$'),
	CONSTRAINT "allocations_completion_or_cancellation" CHECK ("allocations"."completed_at" IS NULL OR "allocations"."cancelled_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "allocation_cut_items" ADD CONSTRAINT "allocation_cut_items_allocation_cut_id_allocation_cuts_id_fk" FOREIGN KEY ("allocation_cut_id") REFERENCES "public"."allocation_cuts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cut_items" ADD CONSTRAINT "allocation_cut_items_allocation_requirement_id_allocation_requirements_id_fk" FOREIGN KEY ("allocation_requirement_id") REFERENCES "public"."allocation_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_cuts" ADD CONSTRAINT "allocation_cuts_allocation_item_id_allocation_items_id_fk" FOREIGN KEY ("allocation_item_id") REFERENCES "public"."allocation_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_items" ADD CONSTRAINT "allocation_items_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_items" ADD CONSTRAINT "allocation_items_stock_item_id_fabric_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."fabric_stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ADD CONSTRAINT "allocation_requirements_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ADD CONSTRAINT "allocation_requirements_fabric_color_id_fabric_colors_id_fk" FOREIGN KEY ("fabric_color_id") REFERENCES "public"."fabric_colors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cut_items_cut_position_unique" ON "allocation_cut_items" USING btree ("allocation_cut_id","position");--> statement-breakpoint
CREATE INDEX "allocation_cut_items_requirement_id_idx" ON "allocation_cut_items" USING btree ("allocation_requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_cuts_item_position_unique" ON "allocation_cuts" USING btree ("allocation_item_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_items_allocation_stock_item_unique" ON "allocation_items" USING btree ("allocation_id","stock_item_id");--> statement-breakpoint
CREATE INDEX "allocation_items_stock_item_id_idx" ON "allocation_items" USING btree ("stock_item_id");--> statement-breakpoint
CREATE INDEX "allocation_requirements_allocation_id_idx" ON "allocation_requirements" USING btree ("allocation_id");--> statement-breakpoint
CREATE INDEX "allocation_requirements_fabric_color_id_idx" ON "allocation_requirements" USING btree ("fabric_color_id");--> statement-breakpoint
CREATE INDEX "allocations_order_number_idx" ON "allocations" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "allocations_created_by_user_id_idx" ON "allocations" USING btree ("created_by_user_id");