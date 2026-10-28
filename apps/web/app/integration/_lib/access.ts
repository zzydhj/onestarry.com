/**
 * 对外集成接口的准入判定（§13 鉴权 / 审查 C1）。
 *
 * 旧实现只判「Access 头在不在」，等于把安全边界整个交给 Cloudflare Zero Trust 的
 * **外部配置**：只要哪天 Application 被摘掉 / 路径改宽，伪造一个
 * `cf-access-authenticated-user-email` 头就能读全量库存、甚至写 inventory。
 * 代码侧零兜底，与其余「鉴权写在代码里、fail-closed」的口径不一致
 * （同款教训见 core/fetchGuard.ts 的注释）。
 *
 * 现在是**两道独立的闸**，任一不过就拒：
 *  1) Access 认证头存在（防直连裸奔：万一 Access 没挂上，这关仍由头把关）；
 *  2) `X-Integration-Key` 与 Workers secret `INTEGRATION_SECRET` 常量时间相等
 *     （防头部伪造：Access 没挂上时密钥仍是唯一真闸）。
 *
 * 密钥**没配** = 本集成未启用 → 503（与项目「fail-closed」口径一致：宁可拒绝服务，不给
 * 公开端点留缝）。密钥已配但不匹配 → 401。两种都拒，绝不放行。
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { secretsMatch } from "@onestarry/core";

export interface AccessCheck {
    ok: boolean;
    status?: number;
    error?: string;
}

/** 外部程序带密钥的请求头（与 Cloudflare Access 的注入头互不重叠，不会被剥离）。 */
export const INTEGRATION_KEY_HEADER = "x-integration-key";

export async function checkAccess(req: Request, opts: { write?: boolean } = {}): Promise<AccessCheck> {
    const email = req.headers.get("cf-access-authenticated-user-email");
    const jwt = req.headers.get("cf-access-jwt-assertion");
    if (!email && !jwt) {
        return {
            ok: false,
            status: 401,
            error: "missing Cloudflare Access assertion — configure a Zero Trust Service Auth token + Access application for /integration/*",
        };
    }

    // env 取不到 = 不在 Workers 运行时（构建期/单元测试）：没有密钥可比，一律拒。
    let secret: string | undefined;
    try {
        secret = getCloudflareContext().env.INTEGRATION_SECRET;
    } catch {
        secret = undefined;
    }
    if (!secret) {
        // 集成未启用（没配 INTEGRATION_SECRET）：503 明确区别于「密钥错」的 401，便于运维定位。
        return {
            ok: false,
            status: 503,
            error: opts.write
                ? "stock write integration disabled — set INTEGRATION_SECRET (workers secret) to enable"
                : "integration disabled — set INTEGRATION_SECRET (workers secret) to enable",
        };
    }
    if (!secretsMatch(req.headers.get(INTEGRATION_KEY_HEADER), secret)) {
        // 不区分"密钥错"与"没带密钥"（同 /api/internal/invalidate）：不给探测者递线索。
        return { ok: false, status: 401, error: "invalid integration key" };
    }
    return { ok: true };
}
