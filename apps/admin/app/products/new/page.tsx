import type { CSSProperties } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAdminAuth } from "@onestarry/auth";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";

const label: CSSProperties = { display: "block", fontSize: 13, margin: "10px 0 4px" };
const field: CSSProperties = { padding: "6px 8px", width: "100%", boxSizing: "border-box" };

/** 新建商品表单（受保护）。提交 → createProductAction → 成功跳详情。 */
export default async function NewProduct({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    const { env } = getCloudflareContext();
    const h = await headers();
    const auth = createAdminAuth({
        connString: env.HYPERDRIVE.connectionString,
        baseURL: `https://${h.get("host") ?? "localhost"}`,
        secret: env.BETTER_AUTH_SECRET,
    });
    const session = await auth.api.getSession({ headers: h });
    if (!session?.user) redirect("/signin");
    const { error } = await searchParams;

    return (
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui" }}>
            <p><Link href="/products">← 返回商品列表</Link></p>
            <h1 style={{ fontSize: 22 }}>新建商品</h1>
            {error === "duplicate" && <p style={{ color: "#c00" }}>SKU 或 Slug 已存在，请换一个。</p>}
            {error === "invalid" && <p style={{ color: "#c00" }}>请至少填写 SKU、标题、有效价格。</p>}

            <form action={createProductAction} style={{ display: "grid", gap: 4 }}>
                <label style={label}>SKU *</label>
                <input name="sku" required style={field} placeholder="如 MY-TSHIRT-BLK-M" />

                <label style={label}>标题 *</label>
                <input name="title" required style={field} placeholder="商品名称（英文）" />

                <label style={label}>Slug（留空按标题自动生成）</label>
                <input name="slug" style={field} placeholder="my-tshirt-blk-m" />

                <label style={label}>描述</label>
                <textarea name="description" rows={3} style={field} />

                <label style={label}>基价 USD *</label>
                <input name="price" type="number" step="0.01" min="0" required style={field} placeholder="19.99" />

                <label style={label}>成本 USD（可选）</label>
                <input name="cost" type="number" step="0.01" min="0" style={field} />

                <label style={label}>重量 g（可选）</label>
                <input name="weight" type="number" min="0" step="1" style={field} />

                <label style={label}>库存 on_hand</label>
                <input name="onHand" type="number" min="0" step="1" defaultValue={0} style={field} />

                <label style={label}>上架状态</label>
                <select name="status" defaultValue="draft" style={field}>
                    <option value="draft">草稿（下架）</option>
                    <option value="active">立即上架</option>
                </select>

                <div style={{ marginTop: 16 }}>
                    <button type="submit">创建商品</button>
                </div>
            </form>
        </main>
    );
}
