-- Blinds move from each allocation to its work order. An allocation then names
-- its order by id and holds only the fabric plan, whose cuts point at the
-- order's lines; the typed order quantity gives way to the total of the lines.
--
-- Rows that have no place in that model stop the migration, changing nothing.
-- Each message carries the query that finds them; resolve them and run again.
DO $$
DECLARE
  found integer;
BEGIN
  SELECT count(*) INTO found FROM "public"."allocations" WHERE "order_number" IS NULL;
  IF found > 0 THEN
    RAISE EXCEPTION '% draft allocation(s) name no order, so their blinds would belong to nothing. Find them with: SELECT id, created_at FROM allocations WHERE order_number IS NULL', found;
  END IF;

  SELECT count(DISTINCT "allocation_id") INTO found FROM "public"."allocation_requirements"
    WHERE "fabric_color_id" IS NULL OR "width_mm" IS NULL OR "length_mm" IS NULL OR "quantity" IS NULL;
  IF found > 0 THEN
    RAISE EXCEPTION '% draft allocation(s) hold half-entered blinds, which a work order cannot. Find them with: SELECT DISTINCT allocation_id FROM allocation_requirements WHERE fabric_color_id IS NULL OR width_mm IS NULL OR length_mm IS NULL OR quantity IS NULL', found;
  END IF;

  -- One drop allowance per plan replaces the allowance stored on each blind.
  SELECT count(*) INTO found FROM (
    SELECT r."allocation_id" FROM "public"."allocation_requirements" r
      JOIN "public"."allocations" a ON a."id" = r."allocation_id"
      WHERE NOT a."is_draft"
      GROUP BY r."allocation_id", a."settings"
      HAVING count(DISTINCT r."length_allowance_mm") > 1
        OR (a."settings" ? 'dropAllowanceMm' AND (a."settings"->>'dropAllowanceMm')::numeric <> max(r."length_allowance_mm"))
  ) mixed;
  IF found > 0 THEN
    RAISE EXCEPTION '% confirmed allocation(s) cut their blinds with differing drop allowances, which one allowance per plan cannot record. Find them with: SELECT allocation_id, array_agg(DISTINCT length_allowance_mm) FROM allocation_requirements GROUP BY 1 HAVING count(DISTINCT length_allowance_mm) > 1', found;
  END IF;

  SELECT count(*) INTO found FROM "public"."work_order_lines";
  IF found > 0 THEN
    RAISE EXCEPTION '% work order line(s) already exist and would be doubled by the blinds moving in. Find them with: SELECT * FROM work_order_lines', found;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "public"."allocations" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
UPDATE "public"."allocations" a SET "work_order_id" = w."id"
  FROM "public"."work_orders" w WHERE w."order_number" = a."order_number";--> statement-breakpoint
UPDATE "public"."allocations" a
  SET "settings" = jsonb_set(a."settings", '{dropAllowanceMm}', to_jsonb(r."allowance"))
  FROM (
    SELECT "allocation_id", max("length_allowance_mm") AS "allowance"
    FROM "public"."allocation_requirements" GROUP BY "allocation_id"
  ) r
  WHERE r."allocation_id" = a."id" AND a."settings" IS NOT NULL AND NOT a."settings" ? 'dropAllowanceMm';--> statement-breakpoint
-- Those updates queued the deferred confirmed-fields trigger for every confirmed
-- row, and a table with pending trigger events cannot be altered. Run them now,
-- while the requirements table the trigger reads is still here.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint

ALTER TABLE "public"."allocations" ALTER COLUMN "work_order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."allocations" ADD CONSTRAINT "allocations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."allocations" DROP CONSTRAINT "allocations_confirmation_valid";--> statement-breakpoint
DROP INDEX "public"."allocations_live_order_number_unique";--> statement-breakpoint
DROP INDEX "public"."allocations_order_number_idx";--> statement-breakpoint
ALTER TABLE "public"."allocations" DROP CONSTRAINT "allocations_order_number_work_orders_order_number_fk";--> statement-breakpoint
ALTER TABLE "public"."allocations" DROP COLUMN "order_number";--> statement-breakpoint
ALTER TABLE "public"."allocations" ADD CONSTRAINT "allocations_confirmation_valid" CHECK (("allocations"."is_draft" AND "allocations"."confirmed_at" IS NULL AND "allocations"."completed_at" IS NULL AND "allocations"."cancelled_at" IS NULL AND "allocations"."submitted_draft_revision" IS NULL) OR (NOT "allocations"."is_draft" AND "allocations"."confirmed_at" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "allocations_work_order_id_idx" ON "public"."allocations" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_live_work_order_unique" ON "public"."allocations" USING btree ("work_order_id") WHERE NOT "allocations"."is_draft" AND "allocations"."cancelled_at" IS NULL;--> statement-breakpoint

-- Every requirement becomes a line under its old id, so cut items go on
-- pointing at it. An order's current blinds are those of its live allocation,
-- else its newest draft, else its newest cancelled allocation; the rest are
-- kept retired, for the plans that were made for them.
INSERT INTO "public"."work_order_lines"
  ("id", "work_order_id", "position", "fabric_color_id", "width_mm", "length_mm", "quantity", "retired_at")
SELECT r."id", a."work_order_id", r."position", r."fabric_color_id", r."width_mm", r."length_mm", r."quantity",
  CASE WHEN a."id" = current."id" THEN NULL ELSE coalesce(a."cancelled_at", a."updated_at") END
FROM "public"."allocation_requirements" r
JOIN "public"."allocations" a ON a."id" = r."allocation_id"
JOIN (
  SELECT DISTINCT ON ("work_order_id") "work_order_id", "id" FROM "public"."allocations"
  ORDER BY "work_order_id",
    CASE WHEN NOT "is_draft" AND "cancelled_at" IS NULL THEN 0 WHEN "is_draft" THEN 1 ELSE 2 END,
    "updated_at" DESC, "id"
) current ON current."work_order_id" = a."work_order_id";--> statement-breakpoint

-- PostgreSQL had cut these two names to its 63 characters.
ALTER TABLE "public"."allocation_cut_items" DROP CONSTRAINT "allocation_cut_items_allocation_requirement_id_allocation_requi";--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" RENAME COLUMN "allocation_requirement_id" TO "work_order_line_id";--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" RENAME CONSTRAINT "allocation_cut_items_allocation_cut_id_allocation_requirement_i" TO "allocation_cut_items_allocation_cut_id_work_order_line_id_pk";--> statement-breakpoint
ALTER INDEX "public"."allocation_cut_items_requirement_id_idx" RENAME TO "allocation_cut_items_work_order_line_id_idx";--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" ADD CONSTRAINT "allocation_cut_items_work_order_line_id_work_order_lines_id_fk" FOREIGN KEY ("work_order_line_id") REFERENCES "public"."work_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- A blind is complete by its columns now, so the confirmed-fields check covers
-- only the plan. Otherwise as in 0010_typed_drafts.
CREATE OR REPLACE FUNCTION public.check_confirmed_draft_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  draft boolean;
  incomplete boolean;
BEGIN
  EXECUTE format('SELECT is_draft FROM %I.%I WHERE id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
    INTO draft USING NEW.id;
  IF draft IS DISTINCT FROM false THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'stock_receipts' THEN
    EXECUTE format('SELECT EXISTS (
      SELECT 1 FROM %I.stock_receipt_items WHERE stock_receipt_id = $1 AND
      (fabric_color_id IS NULL OR width_mm IS NULL OR initial_length_mm IS NULL
       OR quantity IS NULL OR location_id IS NULL))', TG_TABLE_SCHEMA)
      INTO incomplete USING NEW.id;
  ELSE
    EXECUTE format('SELECT
      EXISTS (SELECT 1 FROM %1$I.allocation_items WHERE allocation_id = $1 AND
        (stock_item_id IS NULL OR reserved_length_mm IS NULL))
      OR EXISTS (SELECT 1 FROM %1$I.allocation_cuts c
        JOIN %1$I.allocation_items i ON i.id = c.allocation_item_id
        WHERE i.allocation_id = $1 AND (c.planned_length_mm IS NULL OR c.edge_trim_mm IS NULL))
      OR EXISTS (SELECT 1 FROM %1$I.allocation_cut_items ci
        JOIN %1$I.allocation_cuts c ON c.id = ci.allocation_cut_id
        JOIN %1$I.allocation_items i ON i.id = c.allocation_item_id
        WHERE i.allocation_id = $1 AND ci.quantity IS NULL)', TG_TABLE_SCHEMA)
      INTO incomplete USING NEW.id;
  END IF;

  IF incomplete THEN
    RAISE EXCEPTION 'Confirmed % requires complete child fields', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_confirmed_fields_required';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.recheck_draft_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  parents uuid[];
  parent_id uuid;
  parent_table text := 'allocations';
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  IF TG_TABLE_NAME = 'stock_receipt_items' THEN
    parent_table := 'stock_receipts';
    parents := ARRAY[(old_row->>'stock_receipt_id')::uuid, (new_row->>'stock_receipt_id')::uuid];
  ELSIF TG_TABLE_NAME = 'allocation_items' THEN
    parents := ARRAY[(old_row->>'allocation_id')::uuid, (new_row->>'allocation_id')::uuid];
  ELSIF TG_TABLE_NAME = 'allocation_cuts' THEN
    EXECUTE format('SELECT array_agg(allocation_id) FROM %I.allocation_items WHERE id = ANY($1)', TG_TABLE_SCHEMA)
      INTO parents USING ARRAY[(old_row->>'allocation_item_id')::uuid, (new_row->>'allocation_item_id')::uuid];
  ELSE
    EXECUTE format('SELECT array_agg(i.allocation_id) FROM %1$I.allocation_items i
      JOIN %1$I.allocation_cuts c ON c.allocation_item_id = i.id WHERE c.id = ANY($1)', TG_TABLE_SCHEMA)
      INTO parents USING ARRAY[(old_row->>'allocation_cut_id')::uuid, (new_row->>'allocation_cut_id')::uuid];
  END IF;

  FOR parent_id IN SELECT DISTINCT id FROM unnest(parents) AS ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    -- A row lock alone would not invalidate a concurrent REPEATABLE READ snapshot.
    -- This intentionally unchanged revision creates a new row version and queues
    -- the header constraint trigger without changing the public revision.
    EXECUTE format('UPDATE %I.%I SET revision = revision WHERE id = $1', TG_TABLE_SCHEMA, parent_table)
      USING parent_id;
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TABLE "public"."allocation_requirements";--> statement-breakpoint

ALTER TABLE "public"."work_orders" DROP CONSTRAINT "work_orders_quantity_positive";--> statement-breakpoint
ALTER TABLE "public"."work_orders" DROP COLUMN "quantity";
