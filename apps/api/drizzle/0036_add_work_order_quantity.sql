-- An order states how many blinds it has; an allocation's blinds must add up
-- to it. Orders take the total of their current blinds. One without blinds
-- takes a placeholder of 1, to be corrected by hand; the default is dropped
-- so new orders must state theirs.
ALTER TABLE "public"."work_orders" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "public"."work_orders" w SET "quantity" = l."total"
  FROM (
    SELECT "work_order_id", sum("quantity")::int AS "total"
    FROM "public"."work_order_lines" WHERE "retired_at" IS NULL
    GROUP BY "work_order_id"
  ) l
  WHERE l."work_order_id" = w."id";--> statement-breakpoint
ALTER TABLE "public"."work_orders" ALTER COLUMN "quantity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."work_orders" ADD CONSTRAINT "work_orders_quantity_positive" CHECK ("work_orders"."quantity" > 0);
