import { CART_KEY, useCart } from '~/composables/useCart'
import type { CartItem } from '~/composables/useCart'

/**
 * Client-only: hydrate the shared cart state from localStorage and persist every
 * change back. Runs once at app start, before any component reads the cart.
 */
export default defineNuxtPlugin(() => {
    const { items } = useCart()

    try {
        const raw = localStorage.getItem(CART_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
                // migrate legacy lines that predate the `key` field (product-level carts)
                items.value = (parsed as CartItem[]).map((i) => ({ ...i, key: i.key ?? i.id }))
            }
        }
    } catch {
        /* ignore malformed storage */
    }

    watch(
        items,
        (v) => {
            try {
                localStorage.setItem(CART_KEY, JSON.stringify(v))
            } catch {
                /* storage full / blocked — ignore */
            }
        },
        { deep: true },
    )
})
