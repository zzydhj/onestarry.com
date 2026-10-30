/**
 * core/money.ts —— 「分 → 币种文案」的唯一入口（审查 L7）。
 *
 * 为什么值得单独成文件：这条口径原先在 **9 个页面各抄了一份逐字相同的实现**，另外还有一处
 * `apps/web/lib/format.ts`（只有 ProductCard 在用）。金额展示属于财务口径（小数位、千分位、
 * 符号、按币种取整），下次要改（例如按 market 的 locale 本地化）时九份副本必然只改到一份，
 * 剩下的会安静地显示旧格式且没人报错 —— 这正是"单一真源"要消除的那类漂移。
 *
 * ⚠ 非法币种码**不能**把页面打挂：`markets.currency` 是无约束 text，运营填 "US Dollars" 时
 * 原生 `Intl.NumberFormat` 直接抛（实测 2026-10-29：`XY` / `US Dollars` / `""` → RangeError，
 * `undefined` → TypeError），那就是"一个配置笔误把整棵商品页打成 500"。所以这里退回
 * 「两位小数 + 原始码」：形状仍可读，又不假装它是合法币种。
 *
 * ⚠ 已知分叉，不在本次范围：0 位小数币种（JPY/KRW/VND）本站仍按「分」建模，展示会除以 100，
 * 而 `paypalAmountValue` 把同样的 cents 当整数发给 PayPal —— 两边对同一行数字的理解不同。
 * 那是"接真多币种/FX 时必须一起定"的口径（见 §3.8 的 MVP 假设与架构文档 N2），
 * 单独改展示层只会让两侧更不一致，所以这里保持与旧代码逐字相同的行为。
 */

/** 展示地区：本站前台/后台目前统一按 en-US 排版（多语言展示随市场 locale 接线时改这一处）。 */
const MONEY_LOCALE = "en-US";

/** 内部小数位排版（非法币种码的退路共用它）。 */
const plainNumber = new Intl.NumberFormat(MONEY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(cents: number, currency: string): string {
    const amount = cents / 100;
    try {
        return new Intl.NumberFormat(MONEY_LOCALE, { style: "currency", currency }).format(amount);
    } catch {
        // 币种码不合 Intl 的形状：退成"数字 + 原始码"，宁可少个符号也不让整页 500。
        return `${plainNumber.format(amount)} ${currency || "?"}`;
    }
}
