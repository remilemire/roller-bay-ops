DROP INDEX "stock_receipts_submitter_key_unique";--> statement-breakpoint
ALTER TABLE "allocation_cut_items" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_cuts" ALTER COLUMN "planned_length_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_cuts" ALTER COLUMN "edge_trim_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_items" ALTER COLUMN "stock_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_items" ALTER COLUMN "reserved_length_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ALTER COLUMN "fabric_color_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ALTER COLUMN "width_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ALTER COLUMN "length_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ALTER COLUMN "length_allowance_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocations" ALTER COLUMN "order_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ALTER COLUMN "fabric_color_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ALTER COLUMN "width_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ALTER COLUMN "initial_length_mm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ALTER COLUMN "purchase_order_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ALTER COLUMN "submitted_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ALTER COLUMN "submitted_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stock_receipts" ALTER COLUMN "submitted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_cuts" ADD COLUMN "plan_position" integer;--> statement-breakpoint
ALTER TABLE "allocation_requirements" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "is_draft" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "submitted_draft_revision" integer;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "is_draft" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "submitted_draft_revision" integer;--> statement-breakpoint
-- Existing records were submitted before drafts existed. Preserve their identity,
-- timestamps, key ownership and stock links while adding deterministic ordering.
UPDATE "stock_receipts" SET "is_draft" = false,
  "created_by_user_id" = "submitted_by_user_id",
  "created_at" = "submitted_at", "updated_at" = "submitted_at";
--> statement-breakpoint
UPDATE "allocations" SET "is_draft" = false, "confirmed_at" = "created_at";
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY stock_receipt_id ORDER BY id) AS position
  FROM stock_receipt_items
)
UPDATE stock_receipt_items item SET position = ordered.position
FROM ordered WHERE item.id = ordered.id;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY allocation_id ORDER BY id) AS position
  FROM allocation_requirements
)
UPDATE allocation_requirements requirement SET position = ordered.position
FROM ordered WHERE requirement.id = ordered.id;
--> statement-breakpoint
WITH ordered AS (
  SELECT cut.id, row_number() OVER (
    PARTITION BY item.allocation_id ORDER BY item.stock_item_id, cut.position, cut.id
  ) AS position
  FROM allocation_cuts cut JOIN allocation_items item ON item.id = cut.allocation_item_id
)
UPDATE allocation_cuts cut SET plan_position = ordered.position
FROM ordered WHERE cut.id = ordered.id;
--> statement-breakpoint
ALTER TABLE "stock_receipts" ALTER COLUMN "created_by_user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ALTER COLUMN "position" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "allocation_requirements" ALTER COLUMN "position" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "allocation_cuts" ALTER COLUMN "plan_position" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_requirements_position_unique" ON "allocation_requirements" USING btree ("allocation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipt_items_position_unique" ON "stock_receipt_items" USING btree ("stock_receipt_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipts_creator_key_unique" ON "stock_receipts" USING btree ("created_by_user_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "allocation_cuts" ADD CONSTRAINT "allocation_cuts_plan_position_positive" CHECK ("allocation_cuts"."plan_position" > 0);--> statement-breakpoint
ALTER TABLE "allocation_requirements" ADD CONSTRAINT "allocation_requirements_position_positive" CHECK ("allocation_requirements"."position" > 0);--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_confirmation_valid" CHECK (("allocations"."is_draft" AND "allocations"."confirmed_at" IS NULL AND "allocations"."completed_at" IS NULL AND "allocations"."cancelled_at" IS NULL AND "allocations"."submitted_draft_revision" IS NULL) OR (NOT "allocations"."is_draft" AND "allocations"."confirmed_at" IS NOT NULL AND "allocations"."order_number" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_submitted_revision_valid" CHECK ("allocations"."submitted_draft_revision" IS NULL OR ("allocations"."submitted_draft_revision" > 0 AND "allocations"."submitted_draft_revision" < "allocations"."revision"));--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_position_positive" CHECK ("stock_receipt_items"."position" > 0);--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_revision_positive" CHECK ("stock_receipts"."revision" > 0);--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_submission_valid" CHECK (("stock_receipts"."is_draft" AND "stock_receipts"."submitted_at" IS NULL AND "stock_receipts"."submitted_by_user_id" IS NULL AND "stock_receipts"."submitted_draft_revision" IS NULL) OR (NOT "stock_receipts"."is_draft" AND "stock_receipts"."submitted_at" IS NOT NULL AND "stock_receipts"."submitted_by_user_id" IS NOT NULL AND "stock_receipts"."purchase_order_number" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_submitted_revision_valid" CHECK ("stock_receipts"."submitted_draft_revision" IS NULL OR ("stock_receipts"."submitted_draft_revision" > 0 AND "stock_receipts"."submitted_draft_revision" < "stock_receipts"."revision"));
--> statement-breakpoint
-- Conditional NOT NULL spans multiple tables, so validate the final transaction
-- state. Child changes write their parent to serialize against confirmation,
-- including under REPEATABLE READ (where a stale writer must retry).
-- Resolve tables through TG_TABLE_SCHEMA, including in isolated test schemas.
CREATE FUNCTION public.check_confirmed_draft_fields() RETURNS trigger
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
      EXISTS (SELECT 1 FROM %1$I.allocation_requirements WHERE allocation_id = $1 AND
        (fabric_color_id IS NULL OR width_mm IS NULL OR length_mm IS NULL
         OR length_allowance_mm IS NULL OR quantity IS NULL))
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
$$;
--> statement-breakpoint
CREATE FUNCTION public.recheck_draft_parent() RETURNS trigger
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
  ELSIF TG_TABLE_NAME IN ('allocation_requirements', 'allocation_items') THEN
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
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_receipts_confirmed_fields_required
AFTER INSERT OR UPDATE ON public.stock_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT NEW.is_draft)
EXECUTE FUNCTION public.check_confirmed_draft_fields();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocations_confirmed_fields_required
AFTER INSERT OR UPDATE ON public.allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT NEW.is_draft)
EXECUTE FUNCTION public.check_confirmed_draft_fields();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_receipt_items_recheck_draft_parent
AFTER INSERT OR UPDATE OR DELETE ON public.stock_receipt_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.recheck_draft_parent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocation_requirements_recheck_draft_parent
AFTER INSERT OR UPDATE OR DELETE ON public.allocation_requirements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.recheck_draft_parent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocation_items_recheck_draft_parent
AFTER INSERT OR UPDATE OR DELETE ON public.allocation_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.recheck_draft_parent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocation_cuts_recheck_draft_parent
AFTER INSERT OR UPDATE OR DELETE ON public.allocation_cuts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.recheck_draft_parent();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocation_cut_items_recheck_draft_parent
AFTER INSERT OR UPDATE OR DELETE ON public.allocation_cut_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.recheck_draft_parent();
