import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { createDb, products, productTranslations } from "@onestarry/db";
import { PERMISSIONS } from "@onestarry/core";
import { requirePermission } from "@/lib/auth";
import { buttonVariants, TableFrame, THead, Th, Tr, Td } from "@onestarry/ui";

export const dynamic = "force-dynamic";

/** 后台商品列表（受保护）：未登录跳登录页；读全部商品（跨市场/状态）。 */
export default async function AdminProducts() {
    const { env } = await requirePermission(PERMISSIONS.productWrite);
    const db = createDb(env.HYPERDRIVE.connectionString);
    const rows = await db
        .select({
            id: products.id,
            status: products.status,
            title: productTranslations.title,
        })
        .from(products)
        .leftJoin(
            productTranslations,
            and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, "en")),
        )
        .orderBy(desc(products.createdAt))
        .limit(200);

    return (
        <div className="mx-auto max-w-4xl px-4 py-8">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold tracking-tight">商品 <span className="text-sm font-normal text-muted">（{rows.length}）</span></h1>
                <div className="flex gap-2">
                    <Link href="/products/new" prefetch={false} className={buttonVariants()}>＋ 新建商品</Link>
                    <Link href="/products/import" prefetch={false} className={buttonVariants({ variant: "secondary" })}>⇪ 批量导入</Link>
                </div>
            </div>
            <TableFrame className="mt-6">
                <table className="w-full text-sm">
                    <THead>
                        <tr>
                            <Th>标题</Th>
                            <Th>状态</Th>
                            <Th>商品 ID</Th>
                        </tr>
                    </THead>
                    <tbody>
                        {rows.map((r) => (
                            <Tr key={r.id}>
                                <Td>
                                    <Link href={`/products/${r.id}`} prefetch={false} className="text-accent hover:underline">
                                        {r.title ?? <em className="text-red-600">（缺英文文案）</em>}
                                    </Link>
                                </Td>
                                <Td>{r.status}</Td>
                                <Td className="font-mono text-xs text-muted">{r.id}</Td>
                            </Tr>
                        ))}
                    </tbody>
                </table>
            </TableFrame>
        </div>
    );
}
