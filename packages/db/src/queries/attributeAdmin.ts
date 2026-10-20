import { and, asc, count, eq } from "drizzle-orm";
import { attributeDefinitions, categoryAttributeSets, productOptions } from "../schema";
import type { Db, Tx } from "../client";

export interface AttributeDefInput {
    slug: string;
    name: string;
    dataType: string; // text | number | select | multi_select | boolean | range
    unit: string | null;
    options: string[] | null; // select/multi_select 候选值
    isVariantOption: boolean;
    isFacet: boolean;
    isRequired: boolean;
}

/** 全局属性库列表（按 slug 排序）。 */
export async function listAttributeDefinitions(db: Db | Tx) {
    return db
        .select({
            id: attributeDefinitions.id,
            slug: attributeDefinitions.slug,
            name: attributeDefinitions.name,
            dataType: attributeDefinitions.dataType,
            unit: attributeDefinitions.unit,
            options: attributeDefinitions.options,
            isVariantOption: attributeDefinitions.isVariantOption,
            isFacet: attributeDefinitions.isFacet,
            isRequired: attributeDefinitions.isRequired,
        })
        .from(attributeDefinitions)
        .orderBy(asc(attributeDefinitions.slug));
}

/** 新建属性定义：slug 唯一，重复则返回 { ok:false, error:"duplicate" }。 */
export async function createAttributeDefinition(
    db: Db | Tx,
    input: AttributeDefInput,
): Promise<{ ok: true; id: string } | { ok: false; error: "duplicate" }> {
    const existing = await db
        .select({ id: attributeDefinitions.id })
        .from(attributeDefinitions)
        .where(eq(attributeDefinitions.slug, input.slug))
        .limit(1);
    if (existing.length) return { ok: false, error: "duplicate" };

    const [row] = await db
        .insert(attributeDefinitions)
        .values({
            slug: input.slug,
            name: input.name,
            dataType: input.dataType,
            unit: input.unit,
            options: input.options,
            isVariantOption: input.isVariantOption,
            isFacet: input.isFacet,
            isRequired: input.isRequired,
        })
        .returning({ id: attributeDefinitions.id });
    return { ok: true, id: row!.id };
}

/** 更新属性定义（slug 不可改，作为稳定标识）。 */
export async function updateAttributeDefinition(db: Db | Tx, input: { id: string } & AttributeDefInput): Promise<void> {
    await db
        .update(attributeDefinitions)
        .set({
            name: input.name,
            dataType: input.dataType,
            unit: input.unit,
            options: input.options,
            isVariantOption: input.isVariantOption,
            isFacet: input.isFacet,
            isRequired: input.isRequired,
            updatedAt: new Date(),
        })
        .where(eq(attributeDefinitions.id, input.id));
}

/**
 * 删除属性定义：先解绑引用（清 category_attribute_sets、置空 product_options.attribute_id），再删本体。
 * 事务保证不留悬空引用。
 */
export async function deleteAttributeDefinition(db: Db, id: string): Promise<void> {
    await db.transaction(async (tx) => {
        await tx.delete(categoryAttributeSets).where(eq(categoryAttributeSets.attributeId, id));
        await tx.update(productOptions).set({ attributeId: null }).where(eq(productOptions.attributeId, id));
        await tx.delete(attributeDefinitions).where(eq(attributeDefinitions.id, id));
    });
}

/**
 * 将属性挂到类目（category_attribute_sets）。已存在则更新 override/position，否则插入（position 缺省 = 末尾）。
 * override 传 null 表“继承属性定义本身”。
 */
export async function setCategoryAttribute(
    db: Db | Tx,
    input: { categoryId: string; attributeId: string; position?: number; isRequiredOverride?: boolean | null; isFacetOverride?: boolean | null },
): Promise<void> {
    let position = input.position;
    if (position == null) {
        const c = (await db.select({ n: count() }).from(categoryAttributeSets).where(eq(categoryAttributeSets.categoryId, input.categoryId)))[0]?.n ?? 0;
        position = Number(c);
    }
    await db
        .insert(categoryAttributeSets)
        .values({
            categoryId: input.categoryId,
            attributeId: input.attributeId,
            position,
            isRequiredOverride: input.isRequiredOverride ?? null,
            isFacetOverride: input.isFacetOverride ?? null,
        })
        .onConflictDoUpdate({
            target: [categoryAttributeSets.categoryId, categoryAttributeSets.attributeId],
            set: {
                position,
                isRequiredOverride: input.isRequiredOverride ?? null,
                isFacetOverride: input.isFacetOverride ?? null,
                updatedAt: new Date(),
            },
        });
}

/** 从类目解除某属性关联（只删 category_attribute_sets 行，不动全局定义）。 */
export async function removeCategoryAttribute(db: Db | Tx, input: { categoryId: string; attributeId: string }): Promise<void> {
    await db
        .delete(categoryAttributeSets)
        .where(and(eq(categoryAttributeSets.categoryId, input.categoryId), eq(categoryAttributeSets.attributeId, input.attributeId)));
}
