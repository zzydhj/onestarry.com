/**
 * deps-window.ts —— 依赖「支持窗口」自检（T19）。
 *
 * 用法：`pnpm deps:window`（warn-only，恒退出 0，适合放 CI 里只留痕）
 *      `pnpm deps:window --strict`（已过期/未登记 → 退出 1，适合本地或发布前硬把关）
 *
 * 它查三件事，全部对应 OpenNext/Cloudflare 的真实构建期检查：
 *   1. Next 主版本是否还在官方 2 年支持窗内（超窗 → OpenNext 构建第一步 exit 1）；
 *   2. wrangler 是否满足 Next ≥ 16.1 的最低要求（workerd setImmediate 修复）；
 *   3. 各 Worker 的 workerd compatibility_date 是否已过时（OpenNext 只 warn）。
 */
import { readFileSync } from "node:fs";
import {
    DECLARED_NEXT_MAJOR,
    ACTION_LEAD_DAYS,
    compatDateStale,
    computeMaintenanceWindow,
    maintenanceAlert,
    requiredWranglerMin,
    wranglerRequirementMet,
    WINDOW_STATUS_LABELS,
} from "../maintenance";

// 本文件位于 packages/core/src/scripts/ → 上溯 4 层才是仓库根
const ROOT = new URL("../../../../", import.meta.url);
const STRICT = process.argv.includes("--strict");

/** 读 JSON（允许 jsonc 的整行 // 注释；解析失败返回 null，不让工具本身炸）。 */
function readJson(rel: string): Record<string, unknown> | null {
    try {
        const text = readFileSync(new URL(rel, ROOT), "utf8");
        const stripped = text
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n");
        return JSON.parse(stripped) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function depOf(app: string, field: "dependencies" | "devDependencies", name: string): string | null {
    const pkg = readJson(`apps/${app}/package.json`);
    const bucket = pkg?.[field] as Record<string, string> | undefined;
    return bucket?.[name] ?? null;
}

/** 已安装的精确版本（node_modules 里读得到就用它，否则退回声明的范围）。 */
function installedVersion(app: string, name: string): string | null {
    const pkg = readJson(`apps/${app}/node_modules/${name}/package.json`);
    const v = pkg?.["version"];
    return typeof v === "string" ? v : null;
}

function majorOf(versionSpec: string): number {
    return Number(versionSpec.replace(/[^\d.]/g, "").split(".")[0]);
}

const now = new Date();
const lines: string[] = [];
let expired = false;

// ── 1. Next 支持窗 ──────────────────────────────────────────────────
const nextInstalled = installedVersion("web", "next") ?? depOf("web", "dependencies", "next") ?? "未知";
const nextMajor = majorOf(nextInstalled);
const win = computeMaintenanceWindow(nextMajor, now);
if (win.status === "expired" || win.status === "unknown") expired = true;
lines.push(
    `next            ${nextInstalled.padEnd(12)} 支持至 ${win.supportEndDate ?? "—"}   剩余 ${win.daysLeft ?? "?"} 天   建议 ${win.actionFrom ?? "—"} 开工（提前 ${ACTION_LEAD_DAYS} 天）   [${win.status}] ${WINDOW_STATUS_LABELS[win.status]}`,
);
const alert = maintenanceAlert(nextMajor, now);
if (alert) lines.push(`  ↳ 后台提醒（${alert.level === "expired" ? "红" : "黄"}）：${alert.text}`);
if (nextMajor !== DECLARED_NEXT_MAJOR) {
    expired = true;
    lines.push(`⚠ 漂移：core/maintenance.ts 的 DECLARED_NEXT_MAJOR=${DECLARED_NEXT_MAJOR} 与实际 ${nextMajor} 不一致，请同步`);
}

// ── 2. wrangler 是否满足 Next 的要求 ────────────────────────────────
const wranglerInstalled = installedVersion("web", "wrangler") ?? depOf("web", "devDependencies", "wrangler") ?? "未知";
const need = requiredWranglerMin(nextInstalled);
const okWrangler = wranglerRequirementMet(nextInstalled, wranglerInstalled);
lines.push(
    `wrangler        ${wranglerInstalled.padEnd(12)} ${need ? `要求 ≥ ${need}` : "无额外要求"}   [${okWrangler ? "ok" : "expired"}]${okWrangler ? "" : " 需 bump wrangler"}`,
);
if (!okWrangler) expired = true;

// ── 3. workerd compatibility_date ──────────────────────────────────
for (const app of ["web", "admin", "jobs"] as const) {
    const cfg = readJson(`apps/${app}/wrangler.jsonc`);
    const date = typeof cfg?.["compatibility_date"] === "string" ? (cfg["compatibility_date"] as string) : null;
    if (!date) {
        lines.push(`compat_date[${app}] 未读到（解析失败？跳过）`);
        continue;
    }
    const stale = compatDateStale(date, now);
    lines.push(`compat_date[${app}] ${date.padEnd(12)} ${stale ? "[warn] 已过时，建议更新（OpenNext 也只会 warn）" : "[ok]"}`);
}

console.log(`\n依赖支持窗口自检 · ${now.toISOString()}`);
for (const l of lines) console.log("  " + l);
console.log(
    expired
        ? `\n结论：有项目需要处理${STRICT ? "（--strict → 退出 1）" : "（warn-only，未影响退出码）"}\n`
        : "\n结论：全部在窗口内。\n",
);

process.exit(expired && STRICT ? 1 : 0);
