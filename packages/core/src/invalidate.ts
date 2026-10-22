/**
 * core/invalidate.ts —— 前台按需失效的输入校验（纯函数，可单测；带 IO 的端点在 apps/web）。
 *
 * 为什么要单独抽一层：这个端点拿到密钥后就能对任意路径触发一次全量重渲染，
 * 那是**自带放大倍率的攻击面**（一发 HTTP 换一次跨洋查库渲染）。所以路径必须过白名单，
 * 条数必须设上限；判定与 IO 分开，规则能在无 Workers 上下文下测。
 *
 * 兜底关系（重要）：本模块拒掉的、端点挂掉的、密钥没配的，都不影响正确性 ——
 * 前台每个公共读页都有 `revalidate = 60` 定时器会自己追平。这里只把"典型情况"从 60 秒压到 1~2 秒。
 */

/** 单次请求最多失效多少条路径（一次商品保存实际只要 3~5 条，留足余量又不至于被当批量刷子）。 */
export const INVALIDATE_MAX_PATHS = 20;

/** slug 形状：与 packages/db 的 slugify 产出一致（小写字母数字 + 连字符）。 */
const SEG = String.raw`[a-z0-9][a-z0-9-]{0,79}`;

/**
 * 允许被主动失效的前台路由族。**新增公开路由族时要同步这里**：漏了不会出错，
 * 只是那条页退回靠 60 秒定时器追平（静默地慢，不是响亮地坏）。
 * 最后那条“根级单段”是 CMS 落地页 / page（前台 app/[slug]/page.tsx，如 /about、/faq）：
 * 它形状上无法与 /cart 这类具名段区分，但 revalidatePath 打到不存在/动态的路径上只是无效动作，
 * 最坏情况是白重渲染一次，且条数有上限 —— 调用方是拿密钥的自家 admin，不对外。
 */
const ALLOWED: ReadonlyArray<RegExp> = [
    /^\/$/,
    new RegExp(String.raw`^\/products(?:\/${SEG})?$`),
    new RegExp(String.raw`^\/categories(?:\/${SEG})?$`),
    new RegExp(String.raw`^\/brands(?:\/${SEG})?$`),
    new RegExp(String.raw`^\/blog(?:\/${SEG})?$`),
    new RegExp(String.raw`^\/legal(?:\/[a-z][a-z0-9-]{1,19})?$`),
    new RegExp(String.raw`^\/${SEG}$`),
];

export interface InvalidatePlan {
    /** 通过白名单、已归一化去重的路径。 */
    accepted: string[];
    /** 被拒的原因（与输入顺序一致，便于调用方日志里对上号）。 */
    rejected: Array<{ path: unknown; reason: string }>;
}

/** 归一化：去空白、补前导斜杠、丢多余尾斜杠（根路径除外）。形状不合就返回 null 交调用方拒。 */
function normalize(input: string): string | null {
    let p = input.trim();
    if (!p) return null;
    if (!p.startsWith("/")) p = `/${p}`;
    // 拒绝 query / fragment / 反斜杠 / 连续斜杠：这些要么改不了缓存键（未观察的 searchParams 复用同一条目），
    // 要么根本是另一个资源，白名单不该为它们开口子。
    if (/[\s?#\\]/.test(p) || p.startsWith("//")) return null;
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p || "/";
}

/**
 * 把任意输入解析成"可失效的路径清单 + 拒绝原因"。
 * 非数组、超条数、形状不符、不在白名单，都进 rejected —— **绝不静默丢弃**，
 * 否则"改完不生效"又会变成一个查不出来的坏法（这条正是 docs/PERF.md §7 记录的老坑）。
 */
export function planInvalidatePaths(input: unknown): InvalidatePlan {
    const accepted: string[] = [];
    const rejected: InvalidatePlan["rejected"] = [];

    if (!Array.isArray(input)) {
        return { accepted, rejected: [{ path: input, reason: "paths 必须是数组" }] };
    }

    const seen = new Set<string>();
    for (const raw of input) {
        if (typeof raw !== "string") {
            rejected.push({ path: raw, reason: "路径必须是字符串" });
            continue;
        }
        const p = normalize(raw);
        if (!p) {
            rejected.push({ path: raw, reason: "路径形状不符（要 / 开头、不含 query/fragment）" });
            continue;
        }
        if (!ALLOWED.some((re) => re.test(p))) {
            rejected.push({ path: raw, reason: "不在允许失效的路由族内" });
            continue;
        }
        if (seen.has(p)) continue;
        if (accepted.length >= INVALIDATE_MAX_PATHS) {
            rejected.push({ path: raw, reason: `超过单次上限 ${INVALIDATE_MAX_PATHS} 条` });
            continue;
        }
        seen.add(p);
        accepted.push(p);
    }
    return { accepted, rejected };
}

/**
 * 共享密钥比较：逐字符比到底，不提前因为长度差就返回（少一条"长度可猜"的旁路），
 * 且**密钥没配时一律拒**（fail closed：漏配 secret 的后果是失效退回 60 秒兜底，
 * 而不是端点变成公开刷新按钮）。
 */
export function secretsMatch(candidate: string | undefined | null, secret: string | undefined | null): boolean {
    if (!candidate || !secret) return false;
    if (candidate.length > 512 || secret.length > 512) return false;
    let diff = candidate.length ^ secret.length;
    for (let i = 0; i < candidate.length; i++) {
        diff |= (candidate.charCodeAt(i) ^ secret.charCodeAt(i)) & 0xff;
    }
    return diff === 0;
}
