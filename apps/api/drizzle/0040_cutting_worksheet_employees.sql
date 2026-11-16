CREATE TABLE "cutting_worksheet_employees" (
	"worksheet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name" varchar(120) NOT NULL,
	"employee_initials" varchar(12) NOT NULL,
	CONSTRAINT "cutting_worksheet_employees_pk" PRIMARY KEY("worksheet_id","employee_id")
);
--> statement-breakpoint
ALTER TABLE "cutting_worksheets" DROP CONSTRAINT "cutting_worksheets_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "cutting_worksheet_employees" ADD CONSTRAINT "cutting_worksheet_employees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cutting_worksheet_employees" ADD CONSTRAINT "cutting_worksheet_employees_worksheet_fk" FOREIGN KEY ("worksheet_id") REFERENCES "public"."cutting_worksheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "cutting_worksheet_employees" ("worksheet_id","employee_id","employee_name","employee_initials")
SELECT "id","employee_id","employee_name","employee_initials" FROM "cutting_worksheets";--> statement-breakpoint
ALTER TABLE "cutting_worksheets" DROP COLUMN "employee_id";--> statement-breakpoint
ALTER TABLE "cutting_worksheets" DROP COLUMN "employee_name";--> statement-breakpoint
ALTER TABLE "cutting_worksheets" DROP COLUMN "employee_initials";