-- Blinds move from each work order to the allocations that plan them. An
-- allocation then holds its own blinds with its plan, and the order states
-- only how many it has (0036).
--
-- A draft takes its order's current blinds, as it read them; a confirmed
-- allocation, live or not, takes the blinds its cuts point at. A blind keeps
-- its id on one allocation, the live one, else the newest confirmed, else the
-- newest draft; every other copy gets a new id and its cuts follow it.
--
-- A current blind that nothing would take stops the migration, changing
-- nothing. The message carries the query that finds it; resolve it and run
-- again.
DO $$
DECLARE
  found integer;
BEGIN
  SELECT count(*) INTO found FROM "public"."work_order_lines" l
    WHERE l."retired_at" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "public"."allocations" a
        WHERE a."work_order_id" = l."work_order_id" AND a."is_draft")
      AND NOT EXISTS (
        SELECT 1 FROM "public"."allocation_cut_items" ci
        WHERE ci."work_order_line_id" = l."id");
  IF found > 0 THEN
    RAISE EXCEPTION '% blind(s) are on an order with no draft and in no plan, so they would belong to nothing. Save a draft allocation for their order, or remove them. Find them with: SELECT w.order_number, l.* FROM work_order_lines l JOIN work_orders w ON w.id = l.work_order_id WHERE l.retired_at IS NULL AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.work_order_id = l.work_order_id AND a.is_draft) AND NOT EXISTS (SELECT 1 FROM allocation_cut_items ci WHERE ci.work_order_line_id = l.id)', found;
  END IF;
END $$;--> statement-breakpoint

CREATE TABLE "public"."allocation_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"allocation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"fabric_color_id" uuid,
	"width_mm" numeric(12, 3),
	"length_mm" numeric(12, 3),
	"quantity" integer,
	CONSTRAINT "allocation_requirements_position_positive" CHECK ("allocation_requirements"."position" > 0),
	CONSTRAINT "allocation_requirements_width_mm_positive" CHECK ("allocation_requirements"."width_mm" > 0 AND "allocation_requirements"."width_mm" <> 'NaN'::numeric),
	CONSTRAINT "allocation_requirements_length_mm_positive" CHECK ("allocation_requirements"."length_mm" > 0 AND "allocation_requirements"."length_mm" <> 'NaN'::numeric),
	CONSTRAINT "allocation_requirements_quantity_positive" CHECK ("allocation_requirements"."quantity" > 0)
);--> statement-breakpoint
ALTER TABLE "public"."allocation_requirements" ADD CONSTRAINT "allocation_requirements_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."allocation_requirements" ADD CONSTRAINT "allocation_requirements_fabric_color_id_fabric_colors_id_fk" FOREIGN KEY ("fabric_color_id") REFERENCES "public"."fabric_colors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_requirements_position_unique" ON "public"."allocation_requirements" USING btree ("allocation_id","position");--> statement-breakpoint
CREATE INDEX "allocation_requirements_fabric_color_id_idx" ON "public"."allocation_requirements" USING btree ("fabric_color_id");--> statement-breakpoint

-- Which blinds each allocation takes, and the id each copy gets.
CREATE TEMPORARY TABLE "requirement_copies" AS
SELECT pairs."allocation_id", pairs."line_id",
  CASE WHEN row_number() OVER (
    PARTITION BY pairs."line_id" ORDER BY pairs."rank", pairs."at" DESC, pairs."allocation_id"
  ) = 1 THEN pairs."line_id" ELSE gen_random_uuid() END AS "id"
FROM (
  SELECT DISTINCT i."allocation_id", ci."work_order_line_id" AS "line_id",
    CASE WHEN a."cancelled_at" IS NULL AND a."released_at" IS NULL THEN 0 ELSE 1 END AS "rank",
    a."confirmed_at" AS "at"
  FROM "public"."allocation_cut_items" ci
  JOIN "public"."allocation_cuts" c ON c."id" = ci."allocation_cut_id"
  JOIN "public"."allocation_items" i ON i."id" = c."allocation_item_id"
  JOIN "public"."allocations" a ON a."id" = i."allocation_id"
  WHERE NOT a."is_draft"
  UNION ALL
  SELECT a."id", l."id", 2, a."updated_at"
  FROM "public"."allocations" a
  JOIN "public"."work_order_lines" l ON l."work_order_id" = a."work_order_id" AND l."retired_at" IS NULL
  WHERE a."is_draft"
) pairs;--> statement-breakpoint
INSERT INTO "public"."allocation_requirements"
  ("id", "allocation_id", "position", "fabric_color_id", "width_mm", "length_mm", "quantity")
SELECT r."id", r."allocation_id",
  row_number() OVER (PARTITION BY r."allocation_id" ORDER BY l."position", l."id"),
  l."fabric_color_id", l."width_mm", l."length_mm", l."quantity"
FROM "requirement_copies" r
JOIN "public"."work_order_lines" l ON l."id" = r."line_id";--> statement-breakpoint

-- The cut items point at the copies from here; 0028 named these keys.
ALTER TABLE "public"."allocation_cut_items" DROP CONSTRAINT "allocation_cut_items_work_order_line_id_work_order_lines_id_fk";--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" DROP CONSTRAINT "allocation_cut_items_allocation_cut_id_work_order_line_id_pk";--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" RENAME COLUMN "work_order_line_id" TO "allocation_requirement_id";--> statement-breakpoint
ALTER INDEX "public"."allocation_cut_items_work_order_line_id_idx" RENAME TO "allocation_cut_items_requirement_id_idx";--> statement-breakpoint
-- A draft's assignment of a blind since taken off its order was already left
-- out whenever the draft was read.
DELETE FROM "public"."allocation_cut_items" ci
  USING "public"."allocation_cuts" c, "public"."allocation_items" i
  WHERE c."id" = ci."allocation_cut_id" AND i."id" = c."allocation_item_id"
    AND NOT EXISTS (
      SELECT 1 FROM "requirement_copies" r
      WHERE r."allocation_id" = i."allocation_id" AND r."line_id" = ci."allocation_requirement_id");--> statement-breakpoint
UPDATE "public"."allocation_cut_items" ci SET "allocation_requirement_id" = r."id"
  FROM "public"."allocation_cuts" c, "public"."allocation_items" i, "requirement_copies" r
  WHERE c."id" = ci."allocation_cut_id" AND i."id" = c."allocation_item_id"
    AND r."allocation_id" = i."allocation_id" AND r."line_id" = ci."allocation_requirement_id"
    AND r."id" <> r."line_id";--> statement-breakpoint
-- Those writes queued the deferred parent rechecks, and a table with pending
-- trigger events cannot be altered. Run them now.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" ADD CONSTRAINT "allocation_cut_items_cut_requirement_pk" PRIMARY KEY("allocation_cut_id","allocation_requirement_id");--> statement-breakpoint
ALTER TABLE "public"."allocation_cut_items" ADD CONSTRAINT "allocation_cut_items_requirement_fk" FOREIGN KEY ("allocation_requirement_id") REFERENCES "public"."allocation_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP TABLE "requirement_copies";--> statement-breakpoint
DROP TABLE "public"."work_order_lines";--> statement-breakpoint

-- A confirmed allocation needs at least one blind, each complete. Otherwise as
-- in 0028.
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
      NOT EXISTS (SELECT 1 FROM %1$I.allocation_requirements WHERE allocation_id = $1)
      OR EXISTS (SELECT 1 FROM %1$I.allocation_requirements WHERE allocation_id = $1 AND
        (fabric_color_id IS NULL OR width_mm IS NULL OR length_mm IS NULL OR quantity IS NULL))
      OR EXISTS (SELECT 1 FROM %1$I.allocation_items WHERE allocation_id = $1 AND
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
-- Changes to an allocation's blinds recheck it too. Otherwise as in 0028.
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
  ELSIF TG_TABLE_NAME IN ('allocation_items', 'allocation_requirements') THEN
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
CREATE CONSTRAINT TRIGGER allocation_requirements_recheck_draft_parent
AFTER INSERT OR UPDATE OR DELETE ON public.allocation_requirements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.recheck_draft_parent();
