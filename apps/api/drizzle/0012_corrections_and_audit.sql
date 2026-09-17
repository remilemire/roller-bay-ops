CREATE TABLE "audit_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"record_type" varchar(32) NOT NULL,
	"record_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" varchar(80) NOT NULL,
	"reason" varchar(1000)
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"scope" varchar(80) NOT NULL,
	"record_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "stock_effects" jsonb;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "effective_completion" jsonb;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
-- PostgreSQL 17 supports changing a stored generated expression in place.
-- Add voided_at first; keep the column, its dependencies, and all raw measurements.
ALTER TABLE "fabric_stock_items" ALTER COLUMN "remaining_length_mm" SET EXPRESSION AS (CASE
          WHEN "fabric_stock_items"."voided_at" IS NOT NULL OR "fabric_stock_items"."consumed_at" IS NOT NULL THEN 0::numeric
          WHEN "fabric_stock_items"."is_remnant" THEN "fabric_stock_items"."explicit_length_mm"
          WHEN "fabric_stock_items"."radial_depth_mm" IS NOT NULL THEN
            round(
              pi()::numeric * "fabric_stock_items"."radial_depth_mm"
              * ("fabric_stock_items"."tube_outer_diameter_mm"::numeric + "fabric_stock_items"."radial_depth_mm")
              / nullif("fabric_stock_items"."measurement_thickness_mm", 0),
              3
            )
          ELSE "fabric_stock_items"."initial_length_mm"
        END);--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "stock_effects" jsonb;--> statement-breakpoint
ALTER TABLE "audit_changes" ADD CONSTRAINT "audit_changes_event_id_audit_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_changes_record_idx" ON "audit_changes" USING btree ("record_type","record_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_changes_event_position_unique" ON "audit_changes" USING btree ("event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "correction_requests_scope_key_unique" ON "correction_requests" USING btree ("actor_id","scope","record_id","key");--> statement-breakpoint
ALTER TABLE "fabric_stock_items" ADD CONSTRAINT "fabric_stock_items_revision_positive" CHECK ("fabric_stock_items"."revision" > 0);
