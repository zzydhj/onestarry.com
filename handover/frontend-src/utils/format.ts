/** Shared display formatters — used everywhere, defined once. */

export const money = (n: number): string =>
    '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const compact = (n: number): string =>
    n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n)

/** '★★★★☆' style string for a 0–5 rating (half star folded into nearest) */
export const starString = (rating: number): string => {
    const full = Math.round(rating)
    return '★'.repeat(full) + '☆'.repeat(5 - full)
}

export const discountPct = (price: number, compareAt?: number): number =>
    compareAt && compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0

export const badgeLabel: Record<string, string> = {
    new: 'NEW',
    sale: 'SALE',
    best: 'BEST SELLER',
}

export const badgeClass: Record<string, string> = {
    new: 'bg-[#0a7a52] text-white',
    sale: 'bg-[#d92d27] text-white',
    best: 'bg-ink text-brand',
}
