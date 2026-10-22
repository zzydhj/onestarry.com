/**
 * Product imagery — real photos, no emoji placeholders in the UI.
 * Uses a small, curl-VERIFIED pool of Unsplash image ids (each returns 200).
 * Categories with no verified topical photo (toys) fall back to Lorem Picsum
 * (seeded = stable real photo). The ProductImage component adds a second
 * Picsum fallback on load error, so every product always shows a real image.
 * Replace these ids with your own CDN/product photos later — UI won't change.
 */

interface ImgRef {
    id: string
    category: string
}

/** products that ship with their own real photo URLs (imported items) win outright */
import { importedProduct, importedImages } from '../data/imported'
const FULL_URL: Record<string, string[]> = { [importedProduct.id]: importedImages }

/** explicit, best-match image where a specific product maps cleanly */
const UNSPLASH: Record<string, string> = {
    e1: '1511707171634-5f897ff02aa9', // smartphone
    e2: '1505740420928-5e560c06d30e', // earbuds / headphones
    e5: '1505740420928-5e560c06d30e', // smart speaker
    f2: '1542291026-7eec264c27ff', // sneakers
    f1: '1483985988355-763728e1935b', // apparel
    f7: '1483985988355-763728e1935b', // apparel
    f3: '1434389677669-e08b4cac3105', // down jacket
    f8: '1434389677669-e08b4cac3105', // denim jacket
    a1: '1503376780353-7e6692767b70', // car
    a2: '1583121274602-3e2820c69888',
    a3: '1449965408869-eaa3f722e40d', // car interior
    a4: '1552519507-da3b142c6e3d',
    b1: '1556228720-195a672e8a03', // serum / skincare
    b2: '1522337660859-02fbefca4702', // moisturiser
    b4: '1596462502278-27bfdc403348', // fragrance / cosmetics
    s1: '1571019613454-1cb2f99b2d8b', // dumbbell / fitness
    s6: '1517836357463-d25dfeac3438', // yoga / gym
    s3: '1461896836934-ffe607ba8211', // cycling
    g1: '1484723091739-30a097e8f929', // coffee
}

/** verified pool per category — fills any product not in UNSPLASH + gallery extras */
const POOLS: Record<string, string[]> = {
    electronics: ['1505740420928-5e560c06d30e', '1511707171634-5f897ff02aa9'],
    fashion: ['1542291026-7eec264c27ff', '1483985988355-763728e1935b', '1434389677669-e08b4cac3105', '1595950653106-6c9ebd614d3a', '1549298916-b41d501d3772'],
    home: ['1600585154340-be6161a56a0c', '1556910103-1c02745aae4d', '1584622650111-993a426fbf0a', '1556911220-bff31c812dba', '1547592180-85f173990554'],
    automotive: ['1503376780353-7e6692767b70', '1449965408869-eaa3f722e40d', '1552519507-da3b142c6e3d', '1583121274602-3e2820c69888'],
    beauty: ['1556228720-195a672e8a03', '1596462502278-27bfdc403348', '1522337660859-02fbefca4702'],
    sports: ['1571019613454-1cb2f99b2d8b', '1517836357463-d25dfeac3438', '1461896836934-ffe607ba8211'],
    toys: [],
    grocery: ['1484723091739-30a097e8f929', '1476224203421-9ac39bcb3327', '1473093295043-cdd812d0e601'],
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const poolFor = (cat: string) => POOLS[cat] || []
const unsUrl = (id: string, w: number, h: number) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80`
const picUrl = (seed: string, w: number, h: number) => `https://picsum.photos/seed/${seed}/${w}/${h}`

/** primary image URL for a product (topical Unsplash, else category pool, else Picsum) */
export function productImage(p: ImgRef, opts: { w?: number; h?: number } = {}): string {
    if (FULL_URL[p.id]) return FULL_URL[p.id][0]
    const w = opts.w ?? 640
    const h = opts.h ?? 640
    const pick = UNSPLASH[p.id] || poolFor(p.category)[hash(p.id) % (poolFor(p.category).length || 1)]
    return pick ? unsUrl(pick, w, h) : picUrl(`onestarry-${p.id}`, w, h)
}

/** last-resort fallback used by ProductImage on load error */
export const productImageFallback = (p: ImgRef, opts: { w?: number; h?: number } = {}) =>
    picUrl(`onestarry-${p.id}`, opts.w ?? 640, opts.h ?? 640)

/** up to n distinct image URLs for the detail gallery */
export function productGallery(p: ImgRef, n = 4, size = 800): string[] {
    if (FULL_URL[p.id]) return FULL_URL[p.id].slice(0, n)
    const urls: string[] = [productImage(p, { w: size, h: size })]
    for (const id of poolFor(p.category)) {
        if (urls.length >= n) break
        const u = unsUrl(id, size, size)
        if (!urls.includes(u)) urls.push(u)
    }
    let k = 2
    while (urls.length < n) urls.push(picUrl(`onestarry-${p.id}-${k++}`, size, size))
    return urls
}

/** deterministic circular thumbnail for a mega-menu sub-category chip */
export function subImage(category: string, sub: string, size = 160): string {
    const pool = poolFor(category)
    const pick = pool.length ? pool[hash(`${category}-${sub}`) % pool.length] : ''
    return pick ? unsUrl(pick, size, size) : picUrl(`onestarry-${category}-${sub}`, size, size)
}
