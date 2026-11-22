ALTER TABLE "fabric_stock_items" DROP CONSTRAINT "fabric_stock_items_tube_usage";--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_tube_usage" CHECK ((
        "fabric_stock_items"."is_remnant" AND "fabric_stock_items"."tube_outer_diameter_mm" IS NULL
      ) OR (
        NOT "fabric_stock_items"."is_remnant" AND (
          (NOT "fabric_stock_items"."is_used" AND "fabric_stock_items"."tube_outer_diameter_mm" IS NULL)
          OR ("fabric_stock_items"."is_used" AND ("fabric_stock_items"."tube_outer_diameter_mm" IS NOT NULL OR "fabric_stock_items"."consumed_at" IS NOT NULL))
        )
      ));