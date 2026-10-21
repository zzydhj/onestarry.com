import { NextResponse } from "next/server";
import { healthPayload } from "@onestarry/core";

/**
 * 后台健康端点：不查库、不校验会话（刻意公开，只暴露 git sha 与构建时间）。
 * 用途是"线上跑的是哪个提交"的外部判别与放量核对；不含任何业务数据与内部地址。
 */
export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json(
        healthPayload("onestarry-admin", { gitSha: process.env.APP_GIT_SHA, buildTime: process.env.APP_BUILD_TIME }),
    );
}
