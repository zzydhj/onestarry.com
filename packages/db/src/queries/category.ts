import { asc, eq, isNull } from "drizzle-orm";
import { attributeDefinitions, categories, categoryAttributeSets } from "../schema";
import type { Db, Tx } from "../client";

/** 列出某父类目的直接子类目（parentId=null 取顶层）。用 parent_id 递归，暂不依赖 ltree。 */
export async function listCategoryChildren(db: Db | Tx, parentId: string | null) {
    const where = parentId == null ? isNull(categories.parentId) : eq(categories.parentId, parentId);
    return db.select().from(categories).where(where).orderBy(asc(categories.name));
}

/** 全部类目（扁平，后台按 level/name 排序，前端用 parentId 拼树）。 */
export async function listAllCategories(db: Db | Tx) {
    return db
        .select({ id: categories.id, name: categories.name, parentId: categories.parentId, level: categories.level })
        .from(categories)
        .orderBy(asc(categories.level), asc(categories.name));
}

/** 新建类目：传 parentId 则为其子级，level 自动 = 父.level+1。 */
export async function createCategory(db: Db | Tx, input: { name: string; parentId?: string | null }): Promise<{ id: string }> {
    let level = 1;
    if (input.parentId) {
        const p = (await db.select({ level: categories.level }).from(categories).where(eq(categories.id, input.parentId)).limit(1))[0];
        level = (p?.level ?? 1) + 1;
    }
    const [row] = await db
        .insert(categories)
        .values({ name: input.name, parentId: input.parentId ?? null, level })
        .returning({ id: categories.id });
    return { id: row!.id };
}

/** 重命名类目。 */
export async function renameCategory(db: Db | Tx, input: { id: string; name: string }): Promise<void> {
    await db.update(categories).set({ name: input.name, updatedAt: new Date() }).where(eq(categories.id, input.id));
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
