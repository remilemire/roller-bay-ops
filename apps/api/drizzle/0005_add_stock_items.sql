CREATE TABLE "fabric_stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fabric_color_id" uuid NOT NULL,
	"is_remnant" boolean DEFAULT false NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"width_mm" numeric(12, 3) NOT NULL,
	"initial_length_mm" numeric(12, 3) NOT NULL,
	"explicit_length_mm" numeric(12, 3),
	"radial_depth_mm" numeric(12, 3),
	"tube_outer_diameter_mm" integer,
	"measurement_thickness_mm" numeric(10, 3),
	"remaining_length_mm" numeric(12, 3) GENERATED ALWAYS AS (CASE
          WHEN "fabric_stock_items"."consumed_at" IS NOT NULL THEN 0::numeric
          WHEN "fabric_stock_items"."is_remnant" THEN "fabric_stock_items"."explicit_length_mm"
          WHEN "fabric_stock_items"."radial_depth_mm" IS NOT NULL THEN
            round(
              pi()::numeric * "fabric_stock_items"."radial_depth_mm"
              * ("fabric_stock_items"."tube_outer_diameter_mm"::numeric + "fabric_stock_items"."radial_depth_mm")
              / nullif("fabric_stock_items"."measurement_thickness_mm", 0),
              3
            )
          ELSE "fabric_stock_items"."initial_length_mm"
        END) STORED NOT NULL,
	"location_id" uuid NOT NULL,
	"source_stock_item_id" uuid,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_stock_items_width_mm_positive" CHECK ("fabric_stock_items"."width_mm" > 0 AND "fabric_stock_items"."width_mm" <> 'NaN'::numeric),
	CONSTRAINT "fabric_stock_items_initial_length_mm_positive" CHECK ("fabric_stock_items"."initial_length_mm" > 0 AND "fabric_stock_items"."initial_length_mm" <> 'NaN'::numeric),
	CONSTRAINT "fabric_stock_items_explicit_length_mm_nonnegative" CHECK ("fabric_stock_items"."explicit_length_mm" >= 0 AND "fabric_stock_items"."explicit_length_mm" <> 'NaN'::numeric),
	CONSTRAINT "fabric_stock_items_radial_depth_mm_nonnegative" CHECK ("fabric_stock_items"."radial_depth_mm" >= 0 AND "fabric_stock_items"."radial_depth_mm" <> 'NaN'::numeric),
	CONSTRAINT "fabric_stock_items_tube_outer_diameter_mm_step" CHECK ("fabric_stock_items"."tube_outer_diameter_mm" > 0 AND "fabric_stock_items"."tube_outer_diameter_mm" % 5 = 0),
	CONSTRAINT "fabric_stock_items_tube_usage" CHECK ((
        "fabric_stock_items"."is_remnant" AND "fabric_stock_items"."tube_outer_diameter_mm" IS NULL
      ) OR (
        NOT "fabric_stock_items"."is_remnant" AND (
          (NOT "fabric_stock_items"."is_used" AND "fabric_stock_items"."tube_outer_diameter_mm" IS NULL)
          OR ("fabric_stock_items"."is_used" AND "fabric_stock_items"."tube_outer_diameter_mm" IS NOT NULL)
        )
      )),
	CONSTRAINT "fabric_stock_items_measurement_thickness_mm_positive" CHECK ("fabric_stock_items"."measurement_thickness_mm" > 0 AND "fabric_stock_items"."measurement_thickness_mm" <> 'NaN'::numeric),
	CONSTRAINT "fabric_stock_items_length_source" CHECK ((
        "fabric_stock_items"."is_remnant"
        AND "fabric_stock_items"."explicit_length_mm" IS NOT NULL
        AND "fabric_stock_items"."radial_depth_mm" IS NULL
      ) OR (
        NOT "fabric_stock_items"."is_remnant" AND "fabric_stock_items"."explicit_length_mm" IS NULL
      )),
	CONSTRAINT "fabric_stock_items_measurement_inputs" CHECK ((
        "fabric_stock_items"."radial_depth_mm" IS NULL AND "fabric_stock_items"."measurement_thickness_mm" IS NULL
      ) OR (
        "fabric_stock_items"."radial_depth_mm" IS NOT NULL
        AND "fabric_stock_items"."tube_outer_diameter_mm" IS NOT NULL
        AND "fabric_stock_items"."measurement_thickness_mm" IS NOT NULL
      )),
	CONSTRAINT "fabric_stock_items_source_not_self" CHECK ("fabric_stock_items"."source_stock_item_id" <> "fabric_stock_items"."id")
);
--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_fabric_color_id_fabric_colors_id_fk" FOREIGN KEY ("fabric_color_id") REFERENCES "public"."fabric_colors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_source_stock_item_id_fabric_stock_items_id_fk" FOREIGN KEY ("source_stock_item_id") REFERENCES "public"."fabric_stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fabric_stock_items_fabric_color_id_idx" ON "fabric_stock_items" USING btree ("fabric_color_id");--> statement-breakpoint
CREATE INDEX "fabric_stock_items_location_id_idx" ON "fabric_stock_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "fabric_stock_items_source_stock_item_id_idx" ON "fabric_stock_items" USING btree ("source_stock_item_id");