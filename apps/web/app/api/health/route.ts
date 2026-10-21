import { NextResponse } from "next/server";
import { healthPayload } from "@onestarry/core";

/** 不查库：依赖故障时也要能回答，同时充当 Worker 预热/放量判别靶子。 */
export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json(
        healthPayload("onestarry-web", { gitSha: process.env.APP_GIT_SHA, buildTime: process.env.APP_BUILD_TIME }),
    );
}
