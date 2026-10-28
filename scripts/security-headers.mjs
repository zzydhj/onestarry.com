// 全站安全响应头（web / admin 共用一份，避免两处各写一套迟早漂移）。
// 刻意不含严格 CSP：需配 nonce，易与 Next 水合冲突（见 apps/web/next.config.ts 头注）。
// .mjs 而非 workspace TS 包：next.config.ts 在构建期 Node 里执行，只可靠地 import .mjs/.json。
//
// denyFraming：后台（admin）任何帧都不该有 → X-Frame-Options: DENY；
// 前台（web）保持 SAMEORIGIN（本站自有页可互相嵌，如预览）。
export function securityHeaders({ denyFraming = false } = {}) {
    return [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: denyFraming ? "DENY" : "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
}
