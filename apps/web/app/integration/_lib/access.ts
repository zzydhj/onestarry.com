/**
 * Cloudflare Access 校验（§13 鉴权）。生产应在 Zero Trust 为 `/integration/*` 配
 * 一条 Access Application + Service Auth token；Access 校验通过后向 Worker 注入下游头。
 * 这里做**纵深防御骨架**：要求 Access 认证头存在（缺 → 401）。
 * 严格模式应进一步验 `cf-access-jwt-assertion` 的 JWKS 签名 + aud（本模板留接口，不内置验签）。
 */
export interface AccessCheck {
    ok: boolean;
    status?: number;
    error?: string;
}

export function checkAccess(req: Request): AccessCheck {
    const email = req.headers.get("cf-access-authenticated-user-email");
    const jwt = req.headers.get("cf-access-jwt-assertion");
    if (!email && !jwt) {
        return {
            ok: false,
            status: 401,
            error: "missing Cloudflare Access assertion — configure a Zero Trust Service Auth token + Access application for /integration/*",
        };
    }
    return { ok: true };
}
