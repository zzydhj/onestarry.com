import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SITE_ORIGIN } from "@onestarry/core";
import { getEntitySlug, getContentForEdit, type Db } from "@onestarry/db";

/**
 * 后台 → 前台的按需失效通道。
 *
 * ⚠ 为什么不能在 admin 里直接调 `revalidatePath`：apps/admin 与 apps/web 是两个独立 Worker，
 *   `next/cache` 只清**当前应用**的缓存，admin 进程碰不到 web 的 R2 ISR 条目。
 *   本站此前 10 处 `revalidatePath(`/products/${productId}`)` 因此是双重空转
 *   （跨不了 app，且把实体 id 拼进了 `/products/[slug]` 那个 404 路径，Next 不报错）。
 *   取证与判读见 docs/PERF.md §6/§7。
 *
 * 兜底：这条通道整条挂掉也不影响正确性 —— 前台每个公共读页 `revalidate = 60` 会自己追平。
 * 它只负责把「改完可见」的典型耗时从 ≤60 秒压到 1~2 秒，所以**任何失败都只记日志、不抛错**，
 * 绝不能让一次运营保存因为缓存通知失败而变红。
 */

/** 只用来取 waitUntil；避免为了类型把 workers-types 引进来。 */
type Wait = { waitUntil(p: Promise<unknown>): void };

/** 发一发失效通知。secret 没配就直接返回（前台靠定时器兜底）。 */
async function notifyStorefront(paths: Array<string | null>, secret: string | undefined): Promise<void> {
    const list = paths.filter((p): p is string => !!p);
    if (!secret || list.length === 0) return;
    try {
        const res = await fetch(`${SITE_ORIGIN}/api/internal/invalidate`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
            body: JSON.stringify({ paths: list }),
            signal: AbortSignal.timeout(8000),
        });
        const body = (await res.json().catch(() => null)) as { revalidated?: string[]; rejected?: Array<{ path: unknown; reason: string }> } | null;
        if (!res.ok) {
            console.error(`[invalidate] 前台拒绝（HTTP ${res.status}）：`, list.join(" "));
            return;
        }
        // 拒因必须显形：否则"这个后台动作没接进白名单"又会重演一次静默空转。
        if (body?.rejected?.length) console.error("[invalidate] 部分路径被拒：", JSON.stringify(body.rejected));
        console.info("[invalidate] 已失效：", (body?.revalidated ?? []).join(" "));
    } catch (e) {
        console.error("[invalidate] 通知失败（前台 60s 定时器兜底）：", list.join(" "), e);
    }
}

/** 商品 slug → PDP 路径；slug 取不到（草稿没 slug 等）就只发列表页。 */
async function productPaths(db: Db, productId: string): Promise<string[]> {
    const slug = await getEntitySlug(db, { entityType: "product", entityId: productId, locale: "en" });
    // 首页有商品位、/products 是列表：商品改名/改价/上下架都会影响这两页。
    return [slug ? `/products/${slug}` : "/products", "/products", "/"];
}

/** 类目/品牌 id → 浏览页路径（null 忽略；id 拿不到 slug 也忽略）。 */
async function browsePaths(db: Db, kind: "category" | "brand", ids: Array<string | null>): Promise<string[]> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const slugs = await Promise.all(uniq.map((id) => getEntitySlug(db, { entityType: kind, entityId: id, locale: "en" })));
    return slugs.filter((s): s is string => !!s).map((s) => `/${kind === "category" ? "categories" : "brands"}/${s}`);
}

/**
 * 商品相关写动作（价格/库存/状态/图文/图片/SEO）完成后调：整条链路挂到 waitUntil 上，
 * 不占用户那次的等待时间（一次跨洋查 slug + 一发跨洋 POST，串进响应里白加 ~0.5s）。
 */
export function queueProductInvalidation(input: { ctx: Wait; db: Db; productId: string }): void {
    if (!input.productId) return;
    const { env } = getCloudflareContext();
    const secret = env.INVALIDATE_SECRET;
    input.ctx.waitUntil(productPaths(input.db, input.productId).then((paths) => notifyStorefront(paths, secret)));
}

/**
 * 目录归属变化（类目 / 品牌）后调。要把**新旧两边**的浏览页都失效：
 * 旧类目那一页里这件商品刚被摘掉，新类目那一页里它刚加进来，两页都变了。
 * 写完就查不到旧值了（UPDATE ... RETURNING 只给新行），所以 `prev` 必须由调用方在写**之前**读好传进来
 * —— 那是本动作唯一的额外成本（一条按主键的 SELECT）。
 */
export function queueCatalogInvalidation(input: {
    ctx: Wait;
    db: Db;
    productId: string;
    prev: { categoryId: string | null; brandId: string | null };
    next: { categoryId: string | null; brandId: string | null };
}): void {
    if (!input.productId) return;
    const { env } = getCloudflareContext();
    const secret = env.INVALIDATE_SECRET;
    input.ctx.waitUntil(
        (async () => {
            const paths = [
                ...(await productPaths(input.db, input.productId)),
                ...(await browsePaths(input.db, "category", [input.prev.categoryId, input.next.categoryId])),
                ...(await browsePaths(input.db, "brand", [input.prev.brandId, input.next.brandId])),
            ];
            await notifyStorefront(paths, secret);
        })(),
    );
}

/**
 * CMS 内容在前台的地址。前台路由分两处：type=blog → /blog/<slug>；page|landing → 根级 /<slug>
 * （apps/web/app/[slug]/page.tsx）。单独抽出来是因为删除动作写完就读不到行了，得先算好。
 */
export function contentStorefrontPaths(row: { type: string; urlSlug: string | null } | null): Array<string | null> {
    if (!row?.urlSlug) return [];
    return row.type === "blog" ? [`/blog/${row.urlSlug}`, "/blog"] : [`/${row.urlSlug}`];
}

/** CMS 内容（blog / page / landing）保存后：把刚写完的行读出来算前台地址，再失效。 */
export function queueContentInvalidation(input: { ctx: Wait; db: Db; contentId: string }): void {
    if (!input.contentId) return;
    const { env } = getCloudflareContext();
    const secret = env.INVALIDATE_SECRET;
    input.ctx.waitUntil(
        (async () => {
            await notifyStorefront(contentStorefrontPaths(await getContentForEdit(input.db, input.contentId)), secret);
        })(),
    );
}

/**
 * 直接给前台路径（调用方已经知道确切形状，如类目新增/改名后拿到了最终 slug）。
 * 挂到 waitUntil 上：一发跨洋 POST 不该算在“保存”那一下的等待时间里。
 */
export function queuePathsInvalidation(input: { ctx: Wait; paths: Array<string | null> }): void {
    const { env } = getCloudflareContext();
    input.ctx.waitUntil(notifyStorefront(input.paths, env.INVALIDATE_SECRET));
}

/**
 * 品牌 / 类目自身增改后：失效它的浏览页 + 顶层列表页。
 * 调用方手上往往只有 id（updateBrand 没改 slug 时不返回 slug），所以 slug 现查一次。
 */
export function queueEntityPageInvalidation(input: { ctx: Wait; db: Db; kind: "brand" | "category"; entityId: string; slug?: string | null }): void {
    if (!input.entityId) return;
    const { env } = getCloudflareContext();
    const secret = env.INVALIDATE_SECRET;
    const list = input.kind === "brand" ? "/brands" : "/categories";
    input.ctx.waitUntil(
        (async () => {
            const slug = input.slug ?? (await getEntitySlug(input.db, { entityType: input.kind, entityId: input.entityId, locale: "en" }));
            await notifyStorefront([list, slug ? `${list}/${slug}` : null], secret);
        })(),
    );
}
