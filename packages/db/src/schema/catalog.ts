/**
 * schema/catalog.ts —— 商品目录（§15 步骤 7）
 * 数据驱动的品类/属性/变体/媒体/译文/可售/内容/SEO/评论/跳转。
 * 依赖 foundation.ts 的 markets。库存(步骤8)、定价缓存(步骤9) 在各自文件。
 * 注：ltree、ICU COLLATION、JSONB GIN(jsonb_path_ops) 在迁移 SQL 补（Drizzle 表达不全）。
 */
import {
    pgTable,
    pgEnum,
    uuid,
    text,
    boolean,
    integer,
    bigint,
    jsonb,
    index,
    uniqueIndex,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, timestamps } from "./columns";
import { markets } from "./foundation";

export const productStatusEnum = pgEnum("product_status", ["draft", "active", "archived"]);
export const availabilityPolicyEnum = pgEnum("availability_policy", ["in_stock_only", "backorder", "preorder", "made_to_order"]);
export const attrModeEnum = pgEnum("attr_mode", ["allow", "deny"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "approved", "rejected", "flagged"]);
export const contentStatusEnum = pgEnum("content_status", ["draft", "published", "archived"]);

/* ------------------------------ 品牌 / 类目 ------------------------------ */
export const brands = pgTable("brands", {
    ...timestamps(),
    id: id(),
    name: text("name").notNull(),
    slug: text("slug"),
    manufacturer: jsonb("manufacturer"), // GPSR
    euResponsiblePerson: jsonb("eu_responsible_person"),
});

export const categories = pgTable(
    "categories",
    {
        ...timestamps(),
        id: id(),
        parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
        name: text("name").notNull(),
        path: text("path"), // ltree 路径（迁移 SQL 里 ALTER TYPE ltree）
        level: integer("level").notNull().default(1), // 3–5 层
        isLeaf: boolean("is_leaf").notNull().default(false),
        googleTaxonomyId: text("google_taxonomy_id"), // GMC product_category
    },
    (t) => [index("cat_parent_idx").on(t.parentId), index("cat_path_idx").on(t.path)],
);

/* --------------------------- 属性定义（数据驱动） --------------------------- */
// super_admin 可动态增删；新属性即时对商品可用，不改表结构（§3.2 / §14）
export const attributeDefinitions = pgTable(
    "attribute_definitions",
    {
        ...timestamps(),
        id: id(),
        slug: text("slug").notNull(), // color / size / material ...
        name: text("name").notNull(),
        dataType: text("data_type").notNull().default("text"), // text|number|select|multi_select|boolean|range
        unit: text("unit"),
        options: jsonb("options"), // select 候选值
        isVariantOption: boolean("is_variant_option").notNull().default(false),
        isFacet: boolean("is_facet").notNull().default(false),
        isRequired: boolean("is_required").notNull().default(false),
        localeLabels: jsonb("locale_labels"), // { en, de, ... }
        complianceFields: jsonb("compliance_fields"), // CE/FCC/成分/年龄分级/能效...
    },
    (t) => [uniqueIndex("attr_def_slug_uq").on(t.slug)],
);

export const categoryAttributeSets = pgTable(
    "category_attribute_sets",
    {
        ...timestamps(),
        id: id(),
        categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
        attributeId: uuid("attribute_id").notNull().references(() => attributeDefinitions.id),
        position: integer("position").notNull().default(0),
        isRequiredOverride: boolean("is_required_override"),
        isFacetOverride: boolean("is_facet_override"),
    },
    (t) => [uniqueIndex("cas_category_attr_uq").on(t.categoryId, t.attributeId), index("cas_category_idx").on(t.categoryId)],
);

/* ------------------------------ 商品 SPU / SKU ------------------------------ */
export const products = pgTable(
    "products",
    {
        ...timestamps(),
        id: id(),
        brandId: uuid("brand_id").references(() => brands.id),
        primaryCategoryId: uuid("primary_category_id").references(() => categories.id),
        status: productStatusEnum("status").notNull().default("draft"),
        manufacturer: jsonb("manufacturer"), // GPSR（也可来自 brand）
        euResponsiblePerson: jsonb("eu_responsible_person"),
        attrs: jsonb("attrs"), // SPU 级属性值（GIN jsonb_path_ops 迁移补）
        defaultHsCode: text("default_hs_code"),
        version: integer("version").notNull().default(1), // 乐观锁
    },
    (t) => [index("prod_brand_idx").on(t.brandId), index("prod_cat_idx").on(t.primaryCategoryId), index("prod_status_idx").on(t.status)],
);

export const productOptions = pgTable(
    "product_options",
    {
        ...timestamps(),
        id: id(),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        attributeId: uuid("attribute_id").references(() => attributeDefinitions.id),
        name: text("name").notNull(),
        position: integer("position").notNull().default(0),
    },
    (t) => [index("opt_product_idx").on(t.productId)],
);

export const optionValues = pgTable(
    "option_values",
    {
        ...timestamps(),
        id: id(),
        optionId: uuid("option_id").notNull().references(() => productOptions.id, { onDelete: "cascade" }),
        value: text("value").notNull(),
        valueLabel: jsonb("value_label"), // 多语言显示
        position: integer("position").notNull().default(0),
    },
    (t) => [index("ov_option_idx").on(t.optionId)],
);

export const productVariants = pgTable(
    "product_variants",
    {
        ...timestamps(),
        id: id(),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        sku: text("sku").notNull(),
        optionValueIds: jsonb("option_value_ids"), // 变体矩阵组合
        attrs: jsonb("attrs"), // variant 级属性
        gtin: text("gtin"),
        mpn: text("mpn"),
        condition: text("condition").default("new"),
        hsCode: text("hs_code"),
        countryOfOrigin: text("country_of_origin"),
        customsDescription: text("customs_description"),
        costCents: bigint("cost_cents", { mode: "number" }), // 参考成本；COGS 以 stock_movements 移动平均为准
        basePriceCents: bigint("base_price_cents", { mode: "number" }), // 售价真源（自营单一基价）；null=未定价→不可售
        baseCurrency: text("base_currency").notNull().default("USD"), // 基价币种，按市场汇率折算为市场币种
        weightG: integer("weight_g"),
        dimensionsMm: jsonb("dimensions_mm"),
        availabilityPolicy: availabilityPolicyEnum("availability_policy").notNull().default("in_stock_only"),
        leadTimeDays: integer("lead_time_days"),
        backorderCap: integer("backorder_cap"),
        isPrimary: boolean("is_primary").notNull().default(false),
    },
    (t) => [uniqueIndex("variant_sku_uq").on(t.sku), index("variant_product_idx").on(t.productId)],
);

/* ------------------------------ 媒体 / 图片 ------------------------------ */
export const mediaAssets = pgTable("media_assets", {
    ...timestamps(),
    id: id(),
    kind: text("kind").notNull().default("image"), // image|video|doc
    r2Key: text("r2_key").notNull(),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
    alt: jsonb("alt"), // 按 locale
    variants: jsonb("variants"), // 预生成尺寸变体 { thumb: r2Key, ... }
});

export const productImages = pgTable(
    "product_images",
    {
        ...timestamps(),
        id: id(),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
        mediaId: uuid("media_id").notNull().references(() => mediaAssets.id),
        position: integer("position").notNull().default(0),
    },
    (t) => [index("pimg_product_idx").on(t.productId), index("pimg_variant_idx").on(t.variantId)],
);

/* ------------------------------ slug 单一真源 ------------------------------ */
export const slugs = pgTable(
    "slugs",
    {
        ...timestamps(),
        id: id(),
        entityType: text("entity_type").notNull(), // product|category|collection|brand|content
        entityId: uuid("entity_id").notNull(),
        locale: text("locale").notNull(),
        slug: text("slug").notNull(),
        isCurrent: boolean("is_current").notNull().default(true), // 历史 slug 保留 → 自动 301
    },
    (t) => [uniqueIndex("slug_locale_value_uq").on(t.entityType, t.locale, t.slug), index("slug_entity_idx").on(t.entityType, t.entityId)],
);

/* ------------------------------ 译文（ICU collation） ------------------------------ */
export const productTranslations = pgTable(
    "product_translations",
    {
        ...timestamps(),
        id: id(),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        locale: text("locale").notNull(),
        title: text("title").notNull(),
        description: text("description"),
        bulletPoints: jsonb("bullet_points"),
        aiGenerated: boolean("ai_generated").notNull().default(false),
        manualOverride: boolean("manual_override").notNull().default(false),
    },
    (t) => [uniqueIndex("pt_product_locale_uq").on(t.productId, t.locale)],
);

/* ------------------------------ 集合 / 尺码表 / 收藏 / 到货登记 ------------------------------ */
export const collections = pgTable("collections", {
    ...timestamps(),
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
});

export const collectionProducts = pgTable(
    "collection_products",
    {
        ...timestamps(),
        id: id(),
        collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        position: integer("position").notNull().default(0),
    },
    (t) => [uniqueIndex("cp_collection_product_uq").on(t.collectionId, t.productId)],
);

export const sizeCharts = pgTable("size_charts", {
    ...timestamps(),
    id: id(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("cm"),
    data: jsonb("data").notNull(),
});

export const wishlists = pgTable(
    "wishlists",
    {
        ...timestamps(),
        id: id(),
        customerId: uuid("customer_id").notNull(),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        variantId: uuid("variant_id").references(() => productVariants.id),
    },
    (t) => [uniqueIndex("wishlist_customer_product_uq").on(t.customerId, t.productId)],
);

export const backInStockSubscriptions = pgTable(
    "back_in_stock_subscriptions",
    {
        ...timestamps(),
        id: id(),
        variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
        email: text("email").notNull(),
        locale: text("locale").notNull().default("en"),
        status: text("status").notNull().default("pending"), // pending|notified|cancelled
    },
    (t) => [uniqueIndex("bis_variant_email_uq").on(t.variantId, t.email)],
);

/* ------------------------------ 商品级可售市场（§14） ------------------------------ */
export const productMarketAvailability = pgTable(
    "product_market_availability",
    {
        ...timestamps(),
        id: id(),
        productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
        variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
        marketId: uuid("market_id").notNull().references(() => markets.id),
        mode: attrModeEnum("mode").notNull().default("allow"),
    },
    (t) => [index("pma_market_idx").on(t.marketId), index("pma_product_idx").on(t.productId), index("pma_variant_idx").on(t.variantId)],
);

/* ------------------------------ 内容（博客/页面，自建） ------------------------------ */
export const content = pgTable("content", {
    ...timestamps(),
    id: id(),
    type: text("type").notNull().default("page"), // blog|page|landing
    status: contentStatusEnum("status").notNull().default("draft"),
    authorRef: text("author_ref"),
    publishedAt: text("published_at_iso"),
});

export const contentTranslations = pgTable(
    "content_translations",
    {
        ...timestamps(),
        id: id(),
        contentId: uuid("content_id").notNull().references(() => content.id, { onDelete: "cascade" }),
        locale: text("locale").notNull(),
        title: text("title").notNull(),
        excerpt: text("excerpt"),
        body: jsonb("body"), // ProseMirror JSON
        aiGenerated: boolean("ai_generated").notNull().default(false),
        manualOverride: boolean("manual_override").notNull().default(false),
    },
    (t) => [uniqueIndex("ct_content_locale_uq").on(t.contentId, t.locale)],
);

/* ------------------------------ SEO 元数据（稀疏 + 回退链） ------------------------------ */
export const seoMeta = pgTable(
    "seo_meta",
    {
        ...timestamps(),
        id: id(),
        entityType: text("entity_type").notNull(), // product|category|collection|brand|content|page（无 search）
        entityId: uuid("entity_id").notNull(),
        locale: text("locale").notNull(),
        marketId: uuid("market_id").references(() => markets.id), // NULL=语言级回退
        focusKeyword: text("focus_keyword"),
        seoTitle: text("seo_title"),
        metaDescription: text("meta_description"),
        canonicalUrl: text("canonical_url"),
        robots: jsonb("robots"),
        og: jsonb("og"),
        schemaType: text("schema_type"),
        schemaJson: jsonb("schema_json"),
        noindexReason: text("noindex_reason"),
        aiGenerated: boolean("ai_generated").notNull().default(false),
        manualOverride: boolean("manual_override").notNull().default(false),
    },
    (t) => [uniqueIndex("seo_entity_locale_market_uq").on(t.entityType, t.entityId, t.locale, t.marketId)],
);

/* ------------------------------ 评论 ------------------------------ */
export const reviews = pgTable(
    "reviews",
    {
        ...timestamps(),
        id: id(),
        productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
        variantId: uuid("variant_id").references(() => productVariants.id),
        customerId: uuid("customer_id"),
        orderId: uuid("order_id"),
        verifiedPurchase: boolean("verified_purchase").notNull().default(false),
        rating: integer("rating").notNull(), // 1–5
        title: text("title"),
        body: text("body"),
        locale: text("locale").notNull().default("en"),
        status: reviewStatusEnum("status").notNull().default("pending"),
        helpfulCount: integer("helpful_count").notNull().default(0),
        ownerReply: text("owner_reply"),
    },
    (t) => [index("review_product_status_idx").on(t.productId, t.status)],
);

/* ------------------------------ URL 301（手工任意路径） ------------------------------ */
export const urlRedirects = pgTable(
    "url_redirects",
    {
        ...timestamps(),
        id: id(),
        fromPath: text("from_path").notNull(),
        toPath: text("to_path").notNull(),
        statusCode: integer("status_code").notNull().default(301),
        locale: text("locale"),
        marketId: uuid("market_id").references(() => markets.id),
    },
    (t) => [uniqueIndex("url_redirect_from_uq").on(t.fromPath)],
);

/* ------------------------------ Relations（关键） ------------------------------ */
export const productsRelations = relations(products, ({ one, many }) => ({
    brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
    primaryCategory: one(categories, { fields: [products.primaryCategoryId], references: [categories.id] }),
    variants: many(productVariants),
    options: many(productOptions),
    translations: many(productTranslations),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
    product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
    parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: "catTree" }),
    children: many(categories, { relationName: "catTree" }),
    attributeSets: many(categoryAttributeSets),
}));

export const categoryAttributeSetsRelations = relations(categoryAttributeSets, ({ one }) => ({
    category: one(categories, { fields: [categoryAttributeSets.categoryId], references: [categories.id] }),
    attribute: one(attributeDefinitions, { fields: [categoryAttributeSets.attributeId], references: [attributeDefinitions.id] }),
}));
