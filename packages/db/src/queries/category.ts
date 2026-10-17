import { asc, eq, isNull } from "drizzle-orm";
import { attributeDefinitions, categories, categoryAttributeSets } from "../schema";
import type { Db, Tx } from "../client";

/** 列出某父类目的直接子类目（parentId=null 取顶层）。用 parent_id 递归，暂不依赖 ltree。 */
export async function listCategoryChildren(db: Db | Tx, parentId: string | null) {
    const where = parentId == null ? isNull(categories.parentId) : eq(categories.parentId, parentId);
    return db.select().from(categories).where(where).orderBy(asc(categories.name));
}

/**
 * 取某类目配置的动态属性（category_attribute_sets ⨝ attribute_definitions）。
 * super_admin 后台增删属性即时生效，不改表结构（§3.2 / §14）。
 */
export async function getCategoryAttributes(db: Db | Tx, categoryId: string) {
    return db
        .select({
            attributeId: attributeDefinitions.id,
            slug: attributeDefinitions.slug,
            name: attributeDefinitions.name,
            dataType: attributeDefinitions.dataType,
            unit: attributeDefinitions.unit,
            options: attributeDefinitions.options,
            isVariantOption: attributeDefinitions.isVariantOption,
            isFacet: attributeDefinitions.isFacet,
            localeLabels: attributeDefinitions.localeLabels,
            // 类目级覆盖优先，否则回落属性定义本身
            position: categoryAttributeSets.position,
            isRequired: categoryAttributeSets.isRequiredOverride,
            isFacetEffective: categoryAttributeSets.isFacetOverride,
        })
        .from(categoryAttributeSets)
        .innerJoin(attributeDefinitions, eq(categoryAttributeSets.attributeId, attributeDefinitions.id))
        .where(eq(categoryAttributeSets.categoryId, categoryId))
        .orderBy(asc(categoryAttributeSets.position));
}
