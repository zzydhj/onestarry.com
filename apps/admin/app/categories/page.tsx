import Link from "next/link";
import { createDb, listAllCategories } from "@onestarry/db";
import { requireAdmin } from "@/lib/auth";
import { createCategoryAction, renameCategoryAction } from "./actions";

export const dynamic = "force-dynamic";

/** 类目管理（受保护）：树状列表 + 新增（选父级）+ 重命名。 */
export default async function CategoriesPage() {
    const { env } = await requireAdmin();
    const db = createDb(env.HYPERDRIVE.connectionString);
    const cats = await listAllCategories(db);
    const parentOptions = [{ id: "", name: "（顶层）" }, ...cats.map((c) => ({ id: c.id, name: "　".repeat(c.level - 1) + c.name }))];

    return (
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/">← 返回后台首页</Link></p>
            <h1 style={{ fontSize: 22 }}>类目管理 <span style={{ fontSize: 13, color: "#888" }}>（{cats.length}）</span></h1>

            <form action={createCategoryAction} style={{ display: "flex", gap: 8, margin: "12px 0", alignItems: "center" }}>
                <input name="name" placeholder="新类目名称" required style={{ padding: 6 }} />
                <select name="parentId" style={{ padding: 6 }}>
                    {parentOptions.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
                <button type="submit">新增</button>
            </form>

            <ul style={{ listStyle: "none", padding: 0 }}>
                {cats.map((c) => (
                    <li key={c.id} style={{ marginLeft: (c.level - 1) * 22, margin: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                        <form action={renameCategoryAction} style={{ display: "inline-flex", gap: 6 }}>
                            <input type="hidden" name="id" value={c.id} />
                            <input name="name" defaultValue={c.name} style={{ padding: 4 }} />
                            <button type="submit">改名</button>
                        </form>
                        <span style={{ color: "#999", fontSize: 12 }}>L{c.level}</span>
                    </li>
                ))}
            </ul>
        </main>
    );
}
