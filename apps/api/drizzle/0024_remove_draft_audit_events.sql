-- Drafts are no longer part of audit history. Remove the draft events recorded
-- before that rule; changes go first because they reference their event.
DELETE FROM "audit_changes" WHERE "event_id" IN (
  SELECT "id" FROM "audit_events" WHERE "action" IN (
    'allocation.draft-created', 'allocation.draft-updated', 'allocation.draft-deleted',
    'receipt.draft-created', 'receipt.draft-updated', 'receipt.draft-deleted'
  )
);--> statement-breakpoint
DELETE FROM "audit_events" WHERE "action" IN (
  'allocation.draft-created', 'allocation.draft-updated', 'allocation.draft-deleted',
  'receipt.draft-created', 'receipt.draft-updated', 'receipt.draft-deleted'
);--> statement-breakpoint
-- A submission's "before" was the draft it came from. Related changes in the
-- same event (the scheduled order, received stock) keep their snapshots.
UPDATE "audit_changes" SET "before" = NULL
WHERE "before" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "audit_events"
  WHERE "audit_events"."id" = "audit_changes"."event_id" AND (
    ("audit_events"."action" = 'allocation.confirmed' AND "audit_changes"."record_type" = 'allocations')
    OR ("audit_events"."action" = 'receipt.submitted' AND "audit_changes"."record_type" = 'stock-receipts')
  )
);
