"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
    createAttributeDefinition,
    createDb,
    deleteAttributeDefinition,
    updateAttributeDefinition,
    type AttributeDefInput,
} from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";

const DATA_TYPES = ["text", "number", "select", "multi_select", "boolean", "range"];

/** 从表单解析属性定义输入；name 必填，slug 由调用方按新建/更新决定是否必填。 */
function parseInput(fd: FormData): Omit<AttributeDefInput, "slug"> & { slug: string } {
    const slug = String(fd.get("slug") ?? "").trim().toLowerCase();
    const name = String(fd.get("name") ?? "").trim();
    let dataType = String(fd.get("dataType") ?? "text").trim();
    if (!DATA_TYPES.includes(dataType)) dataType = "text";
    const unit = String(fd.get("unit") ?? "").trim() || null;
    const options = String(fd.get("options") ?? "")
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    return {
        slug,
        name,
        dataType,
        unit,
        options: options.length ? options : null,
        isVariantOption: fd.get("isVariantOption") === "on",
        isFacet: fd.get("isFacet") === "on",
        isRequired: fd.get("isRequired") === "on",
    };
}

/** 新增属性（slug 重复则跳回并带 ?error=duplicate）。 */
export async function createAttributeAction(fd: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const input = parseInput(fd);
    if (!input.slug || !input.name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    const res = await createAttributeDefinition(db, input);
    if (!res.ok) redirect("/attributes?error=duplicate");
    revalidatePath("/attributes");
}

/** 更新属性（slug 不变）。 */
export async function updateAttributeAction(fd: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const id = String(fd.get("id") ?? "");
    if (!id) return;
    const input = parseInput(fd);
    if (!input.name) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await updateAttributeDefinition(db, { id, ...input });
    revalidatePath("/attributes");
}

/** 删除属性（连带解绑引用）。 */
export async function deleteAttributeAction(fd: FormData): Promise<void> {
    const { env } = await requireAdmin();
    const id = String(fd.get("id") ?? "");
    if (!id) return;
    const db = createDb(env.HYPERDRIVE.connectionString);
    await deleteAttributeDefinition(db, id);
    revalidatePath("/attributes");
}
