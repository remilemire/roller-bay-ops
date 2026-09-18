ALTER TABLE "fabric_colors" DROP CONSTRAINT "fabric_colors_code_format";--> statement-breakpoint
ALTER TABLE "fabric_colors" ALTER COLUMN "code" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "fabric_colors" ADD CONSTRAINT "fabric_colors_code_format" CHECK ("fabric_colors"."code" ~ '^[A-Z0-9./-]{1,16}$');