DROP INDEX "users_single_owner_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "users" SET "role" = CASE "role"
	WHEN 'station' THEN 'production'
	WHEN 'user' THEN 'staff'
	ELSE "role"
END;--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('pending', 'production', 'staff', 'admin', 'owner');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'pending'::"public"."user_role";--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_owner_unique" ON "users" USING btree ("role") WHERE "users"."role" = 'owner';
