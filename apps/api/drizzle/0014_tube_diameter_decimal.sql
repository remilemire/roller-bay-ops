ALTER TABLE "fabric_stock_items" DROP CONSTRAINT "fabric_stock_items_tube_outer_diameter_mm_positive";--> statement-breakpoint
-- PostgreSQL refuses to retype a column a generated column reads, so the
-- generated column is dropped first and rebuilt from the same stored inputs.
ALTER TABLE "fabric_stock_items" drop column "remaining_length_mm";--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ALTER COLUMN "tube_outer_diameter_mm" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD COLUMN "remaining_length_mm" numeric(12, 3) GENERATED ALWAYS AS (CASE
          WHEN "fabric_stock_items"."voided_at" IS NOT NULL OR "fabric_stock_items"."consumed_at" IS NOT NULL THEN 0::numeric
          WHEN "fabric_stock_items"."is_remnant" THEN "fabric_stock_items"."explicit_length_mm"
          WHEN "fabric_stock_items"."radial_depth_mm" IS NOT NULL THEN
            round(
              pi()::numeric * "fabric_stock_items"."radial_depth_mm"
              * ("fabric_stock_items"."tube_outer_diameter_mm" + "fabric_stock_items"."radial_depth_mm")
              / nullif("fabric_stock_items"."measurement_thickness_mm", 0),
              3
            )
          ELSE "fabric_stock_items"."initial_length_mm"
        END) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_tube_outer_diameter_mm_positive" CHECK ("fabric_stock_items"."tube_outer_diameter_mm" > 0 AND "fabric_stock_items"."tube_outer_diameter_mm" <> 'NaN'::numeric);