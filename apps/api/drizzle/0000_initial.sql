CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'owner');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"email" varchar(254) NOT NULL,
	"microsoft_subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_microsoft_subject_id_unique" UNIQUE("microsoft_subject_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));