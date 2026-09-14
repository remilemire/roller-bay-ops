CREATE TABLE "fabric_colors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"code" varchar(10) NOT NULL,
	"thickness_mm" numeric(10, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_colors_code_unique" UNIQUE("code"),
	CONSTRAINT "fabric_colors_code_format" CHECK ("fabric_colors"."code" ~ '^[A-Z0-9-]{1,10}$'),
	CONSTRAINT "fabric_colors_thickness_mm_positive" CHECK ("fabric_colors"."thickness_mm" > 0 AND "fabric_colors"."thickness_mm" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "fabric_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fabric_materials_name_not_blank" CHECK (length(btrim("fabric_materials"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturers_name_not_blank" CHECK (length(btrim("manufacturers"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "fabric_colors" ADD CONSTRAINT "fabric_colors_material_id_fabric_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."fabric_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fabric_materials" ADD CONSTRAINT "fabric_materials_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fabric_colors_material_id_idx" ON "fabric_colors" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "fabric_materials_manufacturer_id_idx" ON "fabric_materials" USING btree ("manufacturer_id");