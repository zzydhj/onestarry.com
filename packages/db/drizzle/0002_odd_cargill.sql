CREATE TYPE "public"."principal_kind" AS ENUM('customer', 'admin');--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"preferred_locale" text DEFAULT 'en' NOT NULL,
	"preferred_market_id" uuid,
	"marketing_opt_in_ref" text
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "principal_roles" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" "principal_kind" NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_preferred_market_id_markets_id_fk" FOREIGN KEY ("preferred_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_roles" ADD CONSTRAINT "principal_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cp_user_uq" ON "customer_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_key_uq" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_subject_kind_role_uq" ON "principal_roles" USING btree ("subject_id","kind","role_id");--> statement-breakpoint
CREATE INDEX "pr_subject_idx" ON "principal_roles" USING btree ("subject_id","kind");--> statement-breakpoint
CREATE INDEX "rp_permission_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_key_uq" ON "roles" USING btree ("key");