/**
 * SKU matrix for the PDP.
 *
 * A product's purchasable variants are modelled as orthogonal axes (e.g. Colour,
 * Size). Each SKU = one combination and carries its OWN image, code and stock.
 *
 * Scaling to 100 / 1000 SKUs is purely a data concern: the same builder works —
 * you just feed more options (or load the matrix from Neon in production). The
 * SkuPicker never assumes a fixed count — it renders colour swatches as images
 * and scrolls them when there are many.
 *
 * Images are Picsum-seeded (one real, stable, distinct photo per SKU) so the
 * mechanism is obvious. Swap `image` for your own CDN urls later; nothing else changes.
 */
import type { Product } from './products'
import type { Detail } from './productDetails'
import { importedProduct, importedColors, importedSizes } from './imported'

export type AxisType = 'color' | 'size' | 'other'

export interface Swatch {
    value: string
    image?: string // colour-swatch thumbnail (colour axes only)
}
export interface SkuAxis {
    name: string
    type: AxisType
    options: Swatch[]
}
export interface Sku {
    key: string
    combo: Record<string, string>
    code: string
    image: string
    price?: number
    stock: number
}
export interface SkuModel {
    axes: SkuAxis[]
    skus: Sku[]
    /** the axis used to group gallery thumbnails (usually colour) */
    groupAxis: SkuAxis | null
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const skuImage = (seed: string, size = 700) => `https://picsum.photos/seed/${seed}/${size}/${size}`
const swatchImage = (seed: string) => `https://picsum.photos/seed/${seed}/120/120`

// ---- explicit, richly-authored example: f2 Trailrunner Sneakers ----
// Extreme case on purpose: ONE size offers 100 colours → 100 swatches.
// Each (colour,size) SKU has its OWN photo, so the same colour looks different
// across sizes (as real product photography does).
const COLOR_MODS = ['Jet', 'Deep', 'Soft', 'Classic', 'Vintage', 'Modern', 'Matte', 'Gloss', 'Warm', 'Cool']
const COLOR_WORDS = ['Black', 'White', 'Grey', 'Red', 'Blue', 'Green', 'Teal', 'Navy', 'Olive', 'Sand']
const COLORS: string[] = COLOR_MODS.flatMap((m) => COLOR_WORDS.map((w) => `${m} ${w}`)) // 100
const SIZES = ['39', '40', '41', '42', '43', '44', '45', '46', '47', '48']

function f2Model(p: Product): SkuModel {
    const [min, max] = p.priceRange ?? [p.price, p.price]
    const span = max - min
    const colorAxis: SkuAxis = { name: 'Colour', type: 'color', options: COLORS.map((c) => ({ value: c, image: swatchImage(`c-f2-${c}`) })) }
    const sizeAxis: SkuAxis = { name: 'Size (EU)', type: 'size', options: SIZES.map((s) => ({ value: s })) }
    const skus: Sku[] = []
    COLORS.forEach((c, ci) =>
        SIZES.forEach((sz, si) => {
            const key = `${c}|${sz}`
            // price climbs with both colour order and size, so the set spans exactly min..max
            const price = Math.round((min + (ci / (COLORS.length - 1)) * span * 0.55 + (si / (SIZES.length - 1)) * span * 0.45) * 100) / 100
            skus.push({
                key,
                combo: { 'Colour': c, 'Size (EU)': sz },
                code: `F2-${String(ci + 1).padStart(3, '0')}-${sz}`,
                image: skuImage(`sku-f2-${c}-${sz}`),
                price,
                stock: (hash(key) % 18) + (hash(key) % 11 === 0 ? 0 : 3), // deterministic, some sold out
            })
        }),
    )
    return { axes: [colorAxis, sizeAxis], skus, groupAxis: colorAxis }
}

// ---- generic builder for every other product (from detail.variants) ----
function cartesian(axes: SkuAxis[]): Record<string, string>[] {
    return axes.reduce<Record<string, string>[]>(
        (acc, a) => acc.flatMap((combo) => a.options.map((o) => ({ ...combo, [a.name]: o.value }))),
        [{}],
    )
}

function axisType(name: string): AxisType {
    if (/colou?r/i.test(name)) return 'color'
    if (/size|length/i.test(name)) return 'size'
    return 'other'
}

function genericModel(p: Product, detail: Detail): SkuModel {
    const axes: SkuAxis[] = detail.variants.map((v) => {
        const t = axisType(v.name)
        return {
            name: v.name,
            type: t,
            options: v.options.map((o) => ({ value: o, image: t === 'color' ? swatchImage(`c-${p.id}-${o}`) : undefined })),
        }
    })
    if (!axes.length) {
        // no variants → a single implicit SKU using the product's main image
        return { axes: [], skus: [{ key: 'default', combo: {}, code: `OS-${p.id.toUpperCase()}`, image: '', stock: p.stock }], groupAxis: null }
    }
    const skus: Sku[] = cartesian(axes).map((combo) => {
        const key = axes.map((a) => combo[a.name]).join('|')
        return {
            key,
            combo,
            code: `${p.id.toUpperCase()}-${(hash(key) % 9000) + 1000}`,
            image: skuImage(`sku-${p.id}-${key}`),
            stock: (hash(key) % 16) + 4,
        }
    })
    return { axes, skus, groupAxis: axes.find((a) => a.type === 'color') || null }
}

/** imported product: real per-colour photos + real per-size prices */
function importedModel(): SkuModel {
    const colorAxis: SkuAxis = { name: 'Colour', type: 'color', options: importedColors.map((c) => ({ value: c.name, image: c.image })) }
    const sizeAxis: SkuAxis = { name: 'Size', type: 'size', options: importedSizes.map((s) => ({ value: s.name })) }
    const skus: Sku[] = []
    importedColors.forEach((c, ci) =>
        importedSizes.forEach((s, si) => {
            skus.push({
                key: `${c.name}|${s.name}`,
                combo: { Colour: c.name, Size: s.name },
                code: `TB1-${String(ci + 1).padStart(2, '0')}${String(si + 1)}`,
                image: c.image,
                price: s.price,
                stock: 200,
            })
        }),
    )
    return { axes: [colorAxis, sizeAxis], skus, groupAxis: colorAxis }
}

/** full SKU model for a product (with per-SKU images) */
export function getSkuModel(p: Product, detail: Detail): SkuModel {
    if (p.id === importedProduct.id) return importedModel()
    if (p.id === 'f2') return f2Model(p)
    return genericModel(p, detail)
}
