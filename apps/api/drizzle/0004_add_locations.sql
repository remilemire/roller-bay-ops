CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"label" varchar(40) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_label_format" CHECK (length("locations"."label") > 0 AND "locations"."label" !~ '^[[:space:]]|[[:space:]]$'),
	CONSTRAINT "locations_sort_order_nonnegative" CHECK ("locations"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "location_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"label" varchar(40) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_sections_label_format" CHECK (length("location_sections"."label") > 0 AND "location_sections"."label" !~ '^[[:space:]]|[[:space:]]$'),
	CONSTRAINT "location_sections_sort_order_nonnegative" CHECK ("location_sections"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "location_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_zones_name_format" CHECK (length("location_zones"."name") > 0 AND "location_zones"."name" !~ '^[[:space:]]|[[:space:]]$'),
	CONSTRAINT "location_zones_sort_order_nonnegative" CHECK ("location_zones"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_section_id_location_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."location_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_sections" ADD CONSTRAINT "location_sections_zone_id_location_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."location_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_section_label_unique" ON "locations" USING btree ("section_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "location_sections_zone_label_unique" ON "location_sections" USING btree ("zone_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "location_zones_name_unique" ON "location_zones" USING btree (lower("name"));