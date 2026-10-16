CREATE TYPE "public"."attr_mode" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."availability_policy" AS ENUM('in_stock_only', 'backorder', 'preorder', 'made_to_order');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'flagged');--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"data_type" text DEFAULT 'text' NOT NULL,
	"unit" text,
	"options" jsonb,
	"is_variant_option" boolean DEFAULT false NOT NULL,
	"is_facet" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"locale_labels" jsonb,
	"compliance_fields" jsonb
);
--> statement-breakpoint
CREATE TABLE "back_in_stock_subscriptions" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"manufacturer" jsonb,
	"eu_responsible_person" jsonb
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"path" text,
	"level" integer DEFAULT 1 NOT NULL,
	"is_leaf" boolean DEFAULT false NOT NULL,
	"google_taxonomy_id" text
);
--> statement-breakpoint
CREATE TABLE "category_attribute_sets" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_required_override" boolean,
	"is_facet_override" boolean
);
--> statement-breakpoint
CREATE TABLE "collection_products" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "content" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'page' NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"author_ref" text,
	"published_at_iso" text
);
--> statement-breakpoint
CREATE TABLE "content_translations" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" jsonb,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"manual_override" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"alt" jsonb,
	"variants" jsonb
);
--> statement-breakpoint
CREATE TABLE "option_values" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"option_id" uuid NOT NULL,
	"value" text NOT NULL,
	"value_label" jsonb,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_market_availability" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"market_id" uuid NOT NULL,
	"mode" "attr_mode" DEFAULT 'allow' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_options" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"attribute_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_translations" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"bullet_points" jsonb,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"manual_override" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"option_value_ids" jsonb,
	"attrs" jsonb,
	"gtin" text,
	"mpn" text,
	"condition" text DEFAULT 'new',
	"hs_code" text,
	"country_of_origin" text,
	"customs_description" text,
	"cost_cents" bigint,
	"weight_g" integer,
	"dimensions_mm" jsonb,
	"availability_policy" "availability_policy" DEFAULT 'in_stock_only' NOT NULL,
	"lead_time_days" integer,
	"backorder_cap" integer,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid,
	"primary_category_id" uuid,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"manufacturer" jsonb,
	"eu_responsible_person" jsonb,
	"attrs" jsonb,
	"default_hs_code" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"customer_id" uuid,
	"order_id" uuid,
	"verified_purchase" boolean DEFAULT false NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"owner_reply" text
);
--> statement-breakpoint
CREATE TABLE "seo_meta" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"market_id" uuid,
	"focus_keyword" text,
	"seo_title" text,
	"meta_description" text,
	"canonical_url" text,
	"robots" jsonb,
	"og" jsonb,
	"schema_type" text,
	"schema_json" jsonb,
	"noindex_reason" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"manual_override" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "size_charts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'cm' NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slugs" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "url_redirects" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" integer DEFAULT 301 NOT NULL,
	"locale" text,
	"market_id" uuid
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid
);
--> statement-breakpoint
ALTER TABLE "back_in_stock_subscriptions" ADD CONSTRAINT "back_in_stock_subscriptions_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attribute_sets" ADD CONSTRAINT "category_attribute_sets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attribute_sets" ADD CONSTRAINT "category_attribute_sets_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_translations" ADD CONSTRAINT "content_translations_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_option_id_product_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_market_availability" ADD CONSTRAINT "product_market_availability_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_market_availability" ADD CONSTRAINT "product_market_availability_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_market_availability" ADD CONSTRAINT "product_market_availability_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_primary_category_id_categories_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_meta" ADD CONSTRAINT "seo_meta_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_redirects" ADD CONSTRAINT "url_redirects_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attr_def_slug_uq" ON "attribute_definitions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "bis_variant_email_uq" ON "back_in_stock_subscriptions" USING btree ("variant_id","email");--> statement-breakpoint
CREATE INDEX "cat_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "cat_path_idx" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "cas_category_attr_uq" ON "category_attribute_sets" USING btree ("category_id","attribute_id");--> statement-breakpoint
CREATE INDEX "cas_category_idx" ON "category_attribute_sets" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cp_collection_product_uq" ON "collection_products" USING btree ("collection_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ct_content_locale_uq" ON "content_translations" USING btree ("content_id","locale");--> statement-breakpoint
CREATE INDEX "ov_option_idx" ON "option_values" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "pimg_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "pimg_variant_idx" ON "product_images" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "pma_market_idx" ON "product_market_availability" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pma_product_idx" ON "product_market_availability" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "pma_variant_idx" ON "product_market_availability" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "opt_product_idx" ON "product_options" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_product_locale_uq" ON "product_translations" USING btree ("product_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_sku_uq" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "variant_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "prod_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "prod_cat_idx" ON "products" USING btree ("primary_category_id");--> statement-breakpoint
CREATE INDEX "prod_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_product_status_idx" ON "reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_entity_locale_market_uq" ON "seo_meta" USING btree ("entity_type","entity_id","locale","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slug_locale_value_uq" ON "slugs" USING btree ("entity_type","locale","slug");--> statement-breakpoint
CREATE INDEX "slug_entity_idx" ON "slugs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "url_redirect_from_uq" ON "url_redirects" USING btree ("from_path");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_customer_product_uq" ON "wishlists" USING btree ("customer_id","product_id");