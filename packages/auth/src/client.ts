import { createAuthClient } from "better-auth/client";

/**
 * 浏览器端 Better Auth 客户端工厂（customer 实例）。
 * 只在客户端组件里调用；baseURL 省略时自动用当前站点 origin。
 * 服务端路由在 /api/auth/[...all]，与默认 basePath 对齐。
 */
export function makeAuthClient(baseURL?: string) {
    return createAuthClient(baseURL ? { baseURL } : {});
}

export type AuthClient = ReturnType<typeof makeAuthClient>;
