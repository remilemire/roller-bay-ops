-- The API contract now calls each full-width piece of a plan a "cut" rather
-- than a "drop". Stored JSON that embeds that contract is renamed in place:
-- planning summaries, audit snapshots of allocation records, and each user's
-- unit choice for the cut length. Blind measurements keep their drop names.
CREATE FUNCTION rename_plan_drops_to_cuts(doc jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result jsonb;
  entry record;
BEGIN
  IF doc IS NULL OR jsonb_typeof(doc) NOT IN ('object', 'array') THEN
    RETURN doc;
  END IF;
  IF jsonb_typeof(doc) = 'array' THEN
    SELECT COALESCE(jsonb_agg(rename_plan_drops_to_cuts(element) ORDER BY ordinality), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(doc) WITH ORDINALITY AS elements(element, ordinality);
    RETURN result;
  END IF;
  result := '{}'::jsonb;
  FOR entry IN SELECT key, value FROM jsonb_each(doc) LOOP
    result := result || jsonb_build_object(
      CASE entry.key
        WHEN 'drops' THEN 'cuts'
        WHEN 'dropCount' THEN 'cutCount'
        WHEN 'dropIndex' THEN 'cutIndex'
        ELSE entry.key
      END,
      rename_plan_drops_to_cuts(entry.value));
  END LOOP;
  RETURN result;
END
$$;--> statement-breakpoint
UPDATE "allocations"
SET "planned_summary" = rename_plan_drops_to_cuts("planned_summary")
WHERE "planned_summary" ? 'dropCount';--> statement-breakpoint
UPDATE "audit_changes"
SET "before" = rename_plan_drops_to_cuts("before"),
    "after" = rename_plan_drops_to_cuts("after")
WHERE "record_type" = 'allocations';--> statement-breakpoint
DROP FUNCTION rename_plan_drops_to_cuts(jsonb);--> statement-breakpoint
UPDATE "users"
SET "measurement_units" = ("measurement_units" - 'dropLength')
  || jsonb_build_object('cutLength', "measurement_units"->'dropLength')
WHERE "measurement_units" ? 'dropLength';
