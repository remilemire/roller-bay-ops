CREATE TABLE "scheduled_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(6) NOT NULL,
	"ship_date" date NOT NULL,
	"note" varchar(1000),
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allocated_at" timestamp with time zone,
	"cut_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scheduled_orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "scheduled_orders_order_number_format" CHECK ("scheduled_orders"."order_number" ~ '^[0-9]{6}$'),
	CONSTRAINT "scheduled_orders_revision_positive" CHECK ("scheduled_orders"."revision" > 0),
	CONSTRAINT "scheduled_orders_cut_requires_allocated" CHECK ("scheduled_orders"."cut_at" IS NULL OR "scheduled_orders"."allocated_at" IS NOT NULL)
);
