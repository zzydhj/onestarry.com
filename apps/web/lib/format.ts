/** 分（cents）→ 币种展示，前台统一入口。 */
export function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
