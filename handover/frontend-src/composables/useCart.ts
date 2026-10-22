import type { Product } from '~/data/products'
import type { Sku } from '~/data/skus'

export interface CartItem {
    key: string // unique line key: `${productId}::${skuKey}` for variants, else the product id
    id: string
    name: string
    variant?: string // human label of the chosen combination, e.g. "Jet Black · EU 39"
    skuCode?: string
    image?: string // the SKU's own photo (variant image), when available
    price: number
    glyph: string
    qty: number
}

export const CART_KEY = 'bnk_market_cart'

/**
 * Single source of truth for the cart. State lives in `useState` so it is
 * shared across every component and survives client-side navigation; the
 * `cart.client.ts` plugin hydrates it from localStorage and writes it back.
 */
export function useCart() {
    const items = useState<CartItem[]>('cart', () => [])
    const open = useState<boolean>('cart-open', () => false)

    const find = (key: string) => items.value.find((i) => i.key === key)

    // A product WITHOUT variants is one line per product id; WITH variants it is
    // one line per selected combination (keyed by the SKU), each at its own price.
    const add = (p: Product, qty = 1, sku?: Sku) => {
        const key = sku ? `${p.id}::${sku.key}` : p.id
        const ex = find(key)
        if (ex) ex.qty += qty
        else
            items.value.push({
                key,
                id: p.id,
                name: p.name,
                variant: sku ? Object.values(sku.combo).join(' \u00b7 ') : undefined,
                skuCode: sku?.code,
                image: sku?.image,
                price: sku?.price ?? p.price,
                glyph: p.glyph,
                qty,
            })
    }

    const setQty = (key: string, qty: number) => {
        const i = find(key)
        if (i) i.qty = Math.max(1, Math.floor(qty))
    }

    const inc = (key: string) => setQty(key, (find(key)?.qty ?? 1) + 1)

    const dec = (key: string) => {
        const i = find(key)
        if (i && i.qty > 1) i.qty -= 1
        else remove(key)
    }

    const remove = (key: string) => {
        items.value = items.value.filter((i) => i.key !== key)
    }

    const clear = () => {
        items.value = []
    }

    const count = computed(() => items.value.reduce((s, i) => s + i.qty, 0))
    const subtotal = computed(() => items.value.reduce((s, i) => s + i.price * i.qty, 0))

    const toggle = (v?: boolean) => {
        open.value = v === undefined ? !open.value : v
    }

    return { items, open, add, setQty, inc, dec, remove, clear, count, subtotal, toggle }
}
