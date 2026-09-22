ALTER TYPE "public"."user_role" ADD VALUE 'station' BEFORE 'user';--> statement-breakpoint
CREATE TABLE "cutting_worksheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"order_number" varchar(6) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name" varchar(120) NOT NULL,
	"employee_initials" varchar(12) NOT NULL,
	"started_by_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"draft" jsonb,
	"results" jsonb,
	"baselines" jsonb NOT NULL,
	"applied_stock_revisions" jsonb
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"initials" varchar(12) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"linked_user_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_revision_positive" CHECK ("employees"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_completions" (
	"work_order_id" uuid NOT NULL,
	"station" varchar(16) NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name" varchar(120) NOT NULL,
	"employee_initials" varchar(12) NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	CONSTRAINT "production_completions_work_order_id_station_pk" PRIMARY KEY("work_order_id","station")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "assembled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_worksheets" ADD CONSTRAINT "cutting_worksheets_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completions" ADD CONSTRAINT "production_completions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cutting_worksheets_allocation_unique" ON "cutting_worksheets" USING btree ("allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_linked_user_unique" ON "employees" USING btree ("linked_user_id");--> statement-breakpoint
CREATE INDEX "production_completions_station_time_idx" ON "production_completions" USING btree ("station","completed_at");