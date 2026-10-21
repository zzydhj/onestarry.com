/**
 * 构建指纹（web / admin 两个 next.config 共用，避免复制粘贴后漂移）。
 *
 * 为什么需要：Cloudflare Workers 会同时保留多个历史版本，而**从外部无法确证线上跑的是哪个提交**
 * （此前只能靠"某个新代码特有的响应"反推）。有了 /api/health 暴露的 sha + 构建时间，
 * 分阶段放量时就能直接判断"现在承接流量的版本是不是我要的那个"。
 *
 * 值在**构建期**求值并由 Next 的 `env` 内联进产物，因此反映的是那次构建的提交，不是运行时。
 * git 不可用（例如 CI 容器无 .git）时退化为 "unknown"，绝不让构建失败。
 */
import { execSync } from "node:child_process";

export function buildStamp() {
    let sha = "unknown";
    try {
        sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || "unknown";
    } catch {
        // 拿不到 git 就只留构建时间，不影响出包
    }
    return { APP_GIT_SHA: sha, APP_BUILD_TIME: new Date().toISOString() };
}
