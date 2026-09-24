CREATE TABLE "production_completion_employees" (
	"work_order_id" uuid NOT NULL,
	"station" varchar(16) NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name" varchar(120) NOT NULL,
	"employee_initials" varchar(12) NOT NULL,
	CONSTRAINT "production_completion_employees_pk" PRIMARY KEY("work_order_id","station","employee_id")
);
--> statement-breakpoint
ALTER TABLE "production_completions" DROP CONSTRAINT "production_completions_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "production_completion_employees" ADD CONSTRAINT "production_completion_employees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_completion_employees" ADD CONSTRAINT "production_completion_employees_completion_fk" FOREIGN KEY ("work_order_id","station") REFERENCES "public"."production_completions"("work_order_id","station") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "production_completion_employees" ("work_order_id","station","employee_id","employee_name","employee_initials")
SELECT "work_order_id","station","employee_id","employee_name","employee_initials" FROM "production_completions";--> statement-breakpoint
ALTER TABLE "production_completions" DROP COLUMN "employee_id";--> statement-breakpoint
ALTER TABLE "production_completions" DROP COLUMN "employee_name";--> statement-breakpoint
ALTER TABLE "production_completions" DROP COLUMN "employee_initials";