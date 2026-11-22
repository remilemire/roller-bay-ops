CREATE TABLE "production_recuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"allocation_id" uuid,
	"quantity" integer NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"needs_assembly" boolean NOT NULL,
	"stage" varchar(16) DEFAULT 'requested' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_recuts_allocation_id_unique" UNIQUE("allocation_id"),
	CONSTRAINT "production_recuts_quantity_positive" CHECK ("production_recuts"."quantity" > 0 AND "production_recuts"."revision" > 0),
	CONSTRAINT "production_recuts_stage_valid" CHECK (("production_recuts"."stage" = 'requested' AND "production_recuts"."allocation_id" IS NULL) OR "production_recuts"."stage" = 'withdrawn' OR ("production_recuts"."stage" IN ('cutting','assembly','checking','accepted') AND "production_recuts"."allocation_id" IS NOT NULL))
);
--> statement-breakpoint
DROP INDEX "allocations_live_work_order_unique";--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "is_recut" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "production_recuts" ADD CONSTRAINT "production_recuts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_recuts" ADD CONSTRAINT "production_recuts_requirement_id_allocation_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."allocation_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_recuts" ADD CONSTRAINT "production_recuts_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_recuts_order_stage_idx" ON "production_recuts" USING btree ("work_order_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_live_primary_order_unique" ON "allocations" USING btree ("work_order_id") WHERE NOT "allocations"."is_recut" AND NOT "allocations"."is_draft" AND "allocations"."cancelled_at" IS NULL AND "allocations"."released_at" IS NULL;