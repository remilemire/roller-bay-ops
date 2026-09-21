-- A confirmed allocation must record the four cutting rules it was planned
-- with; one left out would be read back as the current configuration. Rows that
-- lack one stop the migration, changing nothing: nothing here can know what the
-- rule was, so they are yours to set or delete.
DO $$
DECLARE
  found integer;
BEGIN
  SELECT count(*) INTO found FROM "public"."allocations"
    WHERE NOT "is_draft" AND NOT coalesce(
      jsonb_typeof("settings" -> 'edgeTrimMm') = 'number'
      AND jsonb_typeof("settings" -> 'minimumRemnantWidthMm') = 'number'
      AND jsonb_typeof("settings" -> 'minimumRemnantLengthMm') = 'number'
      AND jsonb_typeof("settings" -> 'dropAllowanceMm') = 'number', false);
  IF found > 0 THEN
    RAISE EXCEPTION '% confirmed allocation(s) do not record all four cutting rules as numbers (edgeTrimMm, minimumRemnantWidthMm, minimumRemnantLengthMm, dropAllowanceMm). Find them with: SELECT id, settings FROM allocations WHERE NOT is_draft', found;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_confirmed_rules_recorded" CHECK ("allocations"."is_draft" OR (jsonb_typeof("allocations"."settings" -> 'edgeTrimMm') IS NOT DISTINCT FROM 'number' AND jsonb_typeof("allocations"."settings" -> 'minimumRemnantWidthMm') IS NOT DISTINCT FROM 'number' AND jsonb_typeof("allocations"."settings" -> 'minimumRemnantLengthMm') IS NOT DISTINCT FROM 'number' AND jsonb_typeof("allocations"."settings" -> 'dropAllowanceMm') IS NOT DISTINCT FROM 'number'));