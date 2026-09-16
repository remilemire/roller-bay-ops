ALTER TABLE "allocations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "planned_summary" jsonb;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "completion_key" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "completion_request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "completion" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_creator_idempotency_unique" ON "allocations" USING btree ("created_by_user_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_revision_positive" CHECK ("allocations"."revision" > 0);