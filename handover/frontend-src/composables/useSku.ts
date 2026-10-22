import type { Product } from '~/data/products'
import type { Detail } from '~/data/productDetails'
import { buildDetail } from '~/data/productDetails'
import { getSkuModel, type Sku, type SkuAxis } from '~/data/skus'
import { SKU_LAYOUT } from '~/config/sku'
import { productImage } from '~/utils/productImage'

/**
 * Shared SKU selection for the PDP.
 * `useState` keeps the chosen combination in sync across SkuPicker / ProductBuyBox
 * — both call this and read the same reactive selection, keyed per product so SPA
 * navigation to another product resets cleanly.
 */
export function useSku(product: Product) {
    const detail: Detail = buildDetail(product)
    const model = getSkuModel(product, detail)

    const selection = useState<Record<string, string>>(`sku-sel-${product.id}`, () => {
        const init: Record<string, string> = {}
        model.axes.forEach((a) => (init[a.name] = a.options[0]?.value ?? ''))
        return init
    })

    const hasVariants = computed(() => model.axes.length > 0)
    const colorAxis = computed(() => model.axes.find((a) => a.type === 'color') ?? null)
    const otherAxes = computed(() => model.axes.filter((a) => a.type !== 'color'))

    const selectedSku = computed<Sku | undefined>(() =>
        model.skus.find((s) => model.axes.every((a) => s.combo[a.name] === selection.value[a.name])),
    )

    const mainImage = computed(() => selectedSku.value?.image || productImage(product, { w: 800, h: 800 }))

    /** thumbnails for the strip: the selected colour's SKUs, else every SKU */
    const thumbnails = computed<Sku[]>(() => {
        const g = model.groupAxis
        if (!g) return model.skus
        return model.skus.filter((s) => s.combo[g.name] === selection.value[g.name])
    })

    /** all SKU images (drives the "view all N photos" grid / lightbox) */
    const allSkus = computed(() => model.skus)

    function pick(axis: SkuAxis, value: string) {
        selection.value[axis.name] = value
    }

    /** is a given option of `axis` currently available (any matching SKU in stock)? */
    function optionStock(axis: SkuAxis, value: string): number {
        return model.skus
            .filter((s) =>
                model.axes.every((a) => (a.name === axis.name ? s.combo[a.name] === value : s.combo[a.name] === selection.value[a.name])),
            )
            .reduce((sum, s) => sum + s.stock, 0)
    }

    /**
     * Swatch photo for a colour UNDER the current size — so choosing a different
     * size shows genuinely different colour photos (real products behave this way).
     */
    function imageForColor(value: string): string {
        const g = model.groupAxis
        if (!g) return productImage(product, { w: 160, h: 160 })
        const sku = model.skus.find((s) =>
            model.axes.every((a) => (a.name === g.name ? s.combo[a.name] === value : s.combo[a.name] === selection.value[a.name])),
        )
        return sku?.image || productImage(product, { w: 160, h: 160 })
    }

    // ---- multi-pick staging: per-combo draft quantities (kept OUT of the cart until "Add all") ----
    // Enabled only for high-SKU products (e.g. tb1 / f2); normal products keep the single-combo flow.
    const draft = useState<Record<string, number>>(`sku-draft-${product.id}`, () => ({}))
    const multiPick = computed(() => model.skus.length >= SKU_LAYOUT.MULTI_PICK_MIN_SKUS)

    const draftQty = (key: string): number => draft.value[key] ?? 0
    function setDraftQty(key: string, qty: number) {
        const next = { ...draft.value }
        if (qty <= 0) delete next[key]
        else next[key] = qty
        draft.value = next
    }
    /** the SKU for an option value with every OTHER axis held at its current selection */
    function skuAtSelection(axis: SkuAxis, value: string): Sku | undefined {
        return model.skus.find((s) =>
            model.axes.every((a) => (a.name === axis.name ? s.combo[a.name] === value : s.combo[a.name] === selection.value[a.name])),
        )
    }
    /** number badge: qty for this option × the CURRENT pick on the other axis (e.g. per-size qty for the selected colour) */
    const stagedAtSelection = (axis: SkuAxis, value: string): number => {
        const s = skuAtSelection(axis, value)
        return s ? draftQty(s.key) : 0
    }
    /** dot: does this option have ANY staged qty across the other axes (e.g. which colours are involved at all) */
    const stagedTotal = (axis: SkuAxis, value: string): number =>
        model.skus.reduce((n, s) => (s.combo[axis.name] === value ? n + draftQty(s.key) : n), 0)
    const stagedLines = computed(() => model.skus.filter((s) => draftQty(s.key) > 0).map((s) => ({ sku: s, qty: draftQty(s.key) })))
    const stagedCount = computed(() => stagedLines.value.reduce((n, l) => n + l.qty, 0))
    const stagedSubtotal = computed(() => stagedLines.value.reduce((sum, l) => sum + (l.sku.price ?? product.price) * l.qty, 0))
    const clearDraft = () => (draft.value = {})

    return {
        product,
        detail,
        model,
        selection,
        hasVariants,
        colorAxis,
        otherAxes,
        selectedSku,
        mainImage,
        thumbnails,
        allSkus,
        pick,
        optionStock,
        imageForColor,
        multiPick,
        draftQty,
        setDraftQty,
        stagedAtSelection,
        stagedTotal,
        stagedLines,
        stagedCount,
        stagedSubtotal,
        clearDraft,
    }
}
