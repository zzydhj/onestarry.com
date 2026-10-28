import { and, asc, eq, isNull } from "drizzle-orm";
import { attributeDefinitions, categories, categoryAttributeSets, slugs } from "../schema";
import { setEntitySlug } from "./slug";
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

/** 类目 + 当前 en slug（前台目录索引页用；无 slug 的行 urlSlug 为 null）。 */
export async function listCategoriesWithSlug(db: Db | Tx) {
    return db
        .select({
            id: categories.id,
            name: categories.name,
            parentId: categories.parentId,
            level: categories.level,
            urlSlug: slugs.slug,
        })
        .from(categories)
        .leftJoin(
            slugs,
            and(
                eq(slugs.entityId, categories.id),
                eq(slugs.entityType, "category"),
                eq(slugs.locale, "en"),
                eq(slugs.isCurrent, true),
            ),
        )
        .orderBy(asc(categories.level), asc(categories.name));
}

/** 新建类目：传 parentId 则为其子级，level 自动 = 父.level+1。slug 缺省由 name 派生（写入 slugs 表，前台可达）。 */
export async function createCategory(
    db: Db | Tx,
    input: { name: string; parentId?: string | null; slug?: string; locale?: string },
): Promise<{ id: string; slug: string }> {
    let level = 1;
    if (input.parentId) {
        const p = (await db.select({ level: categories.level }).from(categories).where(eq(categories.id, input.parentId)).limit(1))[0];
        level = (p?.level ?? 1) + 1;
    }
    const [row] = await db
        .insert(categories)
        .values({ name: input.name, parentId: input.parentId ?? null, level })
        .returning({ id: categories.id });
    const slug = await setEntitySlug(db, {
        entityType: "category",
        entityId: row!.id,
        slug: input.slug || input.name,
        locale: input.locale,
    });
    return { id: row!.id, slug };
}

/** 重命名类目（不动 slug，避免破坏已索引 URL）。 */
export async function renameCategory(db: Db | Tx, input: { id: string; name: string }): Promise<void> {
    await db.update(categories).set({ name: input.name, updatedAt: new Date() }).where(eq(categories.id, input.id));
}

/**
 * 更新类目名 + slug。slug 为空则视为不改（保留当前），非空则经 setEntitySlug 处理
 * （与当前不同才动，旧 slug 降历史 → resolveSlug → 前台永久重定向 308）。返回最终 slug。
 */
export async function updateCategory(
    db: Db | Tx,
    input: { id: string; name: string; slug?: string; locale?: string },
): Promise<string | null> {
    await db.update(categories).set({ name: input.name, updatedAt: new Date() }).where(eq(categories.id, input.id));
    if (!input.slug) return null;
    return setEntitySlug(db, { entityType: "category", entityId: input.id, slug: input.slug, locale: input.locale });
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
