/**
 * maintenance.ts —— 依赖「支持窗口」的单一真源（纯函数、零依赖，Worker 与 CLI 脚本共用）。
 *
 * 为什么需要它：OpenNext 在构建的**第一步**硬校验 Next 主版本是否仍在官方 2 年支持窗内
 * （`@opennextjs/aws/dist/build/helper.js` 的 `NEXT_RELEASE_DATES` + `checkNextVersionSupport`），
 * 过期即 `process.exit(1)` → 部署在某个日期突然全红。本模块把那张表抄成**我们自己的预警源**，
 * 让 `pnpm deps:window` 与后台「维护窗口」卡在到期前 60 天就提醒，而不是当天被 CI 通知。
 *
 * ⚠️ 同步义务（升级 Next / OpenNext 时一起做）：
 *   1. `NEXT_MAJOR_RELEASE_DATES` 与 OpenNext 的表保持一致（它未登记的主版本 = 判不支持）；
 *   2. `DECLARED_NEXT_MAJOR` 改成新的主版本。
 * 漂移会被 `maintenance.test.ts` 拦下 —— 那个测试直接读 `apps/web/package.json` 的真实版本比对。
 */

/** 各 Next 主版本的官方发布日期（抄自 OpenNext 支持表）。 */
export const NEXT_MAJOR_RELEASE_DATES: Readonly<Record<number, string>> = {
    16: "2025-10-21",
    15: "2024-10-21",
    14: "2023-10-26",
    13: "2022-10-26",
    12: "2021-10-26",
};

/** 本项目当前声明使用的 Next 主版本（必须与 apps/web/package.json 一致，由单测把关）。 */
export const DECLARED_NEXT_MAJOR = 16;

/** Next.js 官方支持政策：每个主版本自发布起维护 2 年。 */
export const SUPPORT_YEARS = 2;

/** 剩余天数 ≤ 此值即转「warn」（颜色级别的硬告警线）。 */
export const WARN_DAYS_BEFORE_EXPIRY = 60;

/**
 * 该开始排期升级的提前量（天）。
 * 为什么定 180：本模板的维护者**不看依赖报告、不做月度巡检**，唯一触发器就是后台提醒；
 * 若只提前 60 天提示，对方“半年上线看一次”就会错过窗口。所以提前半年就提醒，
 * 并给出一个**具体开工日期**（而不是“还剩 N 天”）。
 */
export const ACTION_LEAD_DAYS = 180;

/** Next ≥ 16.1 需要 wrangler ≥ 4.59.2（workerd 的 setImmediate 修复，OpenNext 只 warn 不拦）。 */
export const WRANGLER_MIN_FOR_NEXT_16_1 = "4.59.2";

/** workerd `compatibility_date` 超过这个月数，OpenNext 构建会提示建议更新。 */
export const COMPAT_DATE_STALE_MONTHS = 6;

export type WindowStatus = "ok" | "warn" | "expired" | "unknown";

export interface MaintenanceWindow {
    /** 被检查的 Next 主版本 */
    major: number;
    /** 官方发布日期（YYYY-MM-DD）；未登记则为 null */
    releaseDate: string | null;
    /** 支持截止日（YYYY-MM-DD，UTC）；未登记则为 null */
    supportEndDate: string | null;
    /** 剩余天数（可为负 = 已过期）；未登记则为 null */
    daysLeft: number | null;
    /** 建议开工日（= 支持截止日 - ACTION_LEAD_DAYS）；未登记则为 null */
    actionFrom: string | null;
    /** 是否已进入该排期升级的区间（含已过期） */
    needsAction: boolean;
    status: WindowStatus;
}

/** 给导航/卡片用的一行提醒文案；无需行动时 null。 */
export interface MaintenanceAlert {
    level: "soon" | "expired";
    text: string;
}

const DAY_MS = 86_400_000;

/** 某主版本的支持截止日（UTC 零点）；表里没有 → null（OpenNext 同样判为不支持）。 */
export function supportEndForMajor(major: number): Date | null {
    const release = NEXT_MAJOR_RELEASE_DATES[major];
    if (!release) return null;
    const end = new Date(`${release}T00:00:00Z`);
    end.setUTCFullYear(end.getUTCFullYear() + SUPPORT_YEARS);
    return end;
}

/** 按剩余天数判状态：已过期 / 提前 60 天预警 / 正常。 */
export function windowStatusForDays(daysLeft: number): WindowStatus {
    if (daysLeft < 0) return "expired";
    if (daysLeft <= WARN_DAYS_BEFORE_EXPIRY) return "warn";
    return "ok";
}

/** 建议开工日（YYYY-MM-DD）= 支持截止日往前推 ACTION_LEAD_DAYS 天。 */
export function actionDateForMajor(major: number): string | null {
    const end = supportEndForMajor(major);
    if (!end) return null;
    end.setUTCDate(end.getUTCDate() - ACTION_LEAD_DAYS);
    return end.toISOString().slice(0, 10);
}

/** 计算某主版本的维护窗口（默认用本项目的声明版本）。 */
export function computeMaintenanceWindow(major: number = DECLARED_NEXT_MAJOR, now: Date = new Date()): MaintenanceWindow {
    const release = NEXT_MAJOR_RELEASE_DATES[major] ?? null;
    const end = supportEndForMajor(major);
    const actionFrom = actionDateForMajor(major);
    if (!end || !release) {
        return { major, releaseDate: release, supportEndDate: null, daysLeft: null, actionFrom, needsAction: true, status: "unknown" };
    }
    const daysLeft = Math.floor((end.getTime() - now.getTime()) / DAY_MS);
    return {
        major,
        releaseDate: release,
        supportEndDate: end.toISOString().slice(0, 10),
        daysLeft,
        actionFrom,
        needsAction: daysLeft <= ACTION_LEAD_DAYS,
        status: windowStatusForDays(daysLeft),
    };
}

/**
 * 一行提醒（导航徽章 / 顶部提示条用）。
 * 未登记主版本也当作“需要行动”——它同样会被 OpenNext 拦住。
 */
export function maintenanceAlert(major: number = DECLARED_NEXT_MAJOR, now: Date = new Date()): MaintenanceAlert | null {
    const w = computeMaintenanceWindow(major, now);
    if (w.status === "expired") {
        return { level: "expired", text: `Next ${w.major} 支持窗已过（${w.supportEndDate}）· 部署会被 OpenNext 拦下，请立即升级` };
    }
    if (w.status === "unknown") {
        return { level: "expired", text: `Next ${w.major} 未登记在支持表内 · OpenNext 会判为不支持，请同步 core/maintenance.ts 与 OpenNext 版本` };
    }
    if (w.needsAction) {
        return { level: "soon", text: `Next ${w.major} 支持至 ${w.supportEndDate}（剩 ${w.daysLeft} 天）· 建议 ${w.actionFrom} 前开始升级` };
    }
    return null;
}

/** 简易 semver 比较（只比 major.minor.patch，忽略预发布后缀）：a>b→1，a<b→-1，相等→0。 */
export function semverCompare(a: string, b: string): number {
    const pa = a.split(".").map((x) => parseInt(x, 10));
    const pb = b.split(".").map((x) => parseInt(x, 10));
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

/** 该 Next 版本对 wrangler 的最低要求；无要求 → null。 */
export function requiredWranglerMin(nextVersion: string): string | null {
    return semverCompare(nextVersion, "16.1.0") >= 0 ? WRANGLER_MIN_FOR_NEXT_16_1 : null;
}

/** wrangler 版本是否满足 Next 的要求（无要求时恒为 true）。 */
export function wranglerRequirementMet(nextVersion: string, wranglerVersion: string): boolean {
    const min = requiredWranglerMin(nextVersion);
    return min === null || semverCompare(wranglerVersion, min) >= 0;
}

/** workerd compatibility_date 是否已过时（早于 now - 6 个月）。 */
export function compatDateStale(dateStr: string, now: Date = new Date()): boolean {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    const cutoff = new Date(now.getTime());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - COMPAT_DATE_STALE_MONTHS);
    return d.getTime() < cutoff.getTime();
}

/** 状态的可读标签（后台卡片与 CLI 共用，避免两处各写一份中文）。 */
export const WINDOW_STATUS_LABELS: Readonly<Record<WindowStatus, string>> = {
    ok: "在支持窗内",
    warn: "临近到期（≤60 天）",
    expired: "已过期：OpenNext 会拒绝构建",
    unknown: "主版本未登记在支持表内（OpenNext 会判为不支持）",
};
