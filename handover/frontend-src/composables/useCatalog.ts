import { categories, categoryBySlug } from '~/data/categories'
import { products, productById, productsByCategory } from '~/data/products'
import type { Product } from '~/data/products'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** keyword search across name / brand / category / blurb */
function searchProducts(q: string): Product[] {
    const t = norm(q)
    if (!t) return []
    const words = t.split(' ').filter(Boolean)
    return products.filter((p) => {
        const hay = norm(`${p.name} ${p.brand} ${p.sub} ${categoryBySlug(p.category)?.name ?? ''} ${p.blurb}`)
        return words.every((w) => hay.includes(w))
    })
}

/**
 * Catalog access + the filters used by the category and search pages.
 * Keeping this in one place means pages never re-implement matching logic.
 */
export function useCatalog() {
    const sortProducts = (list: Product[], sort: string): Product[] => {
        const arr = [...list]
        switch (sort) {
            case 'price-asc':
                return arr.sort((a, b) => a.price - b.price)
            case 'price-desc':
                return arr.sort((a, b) => b.price - a.price)
            case 'rating':
                return arr.sort((a, b) => b.rating - a.rating)
            case 'reviews':
                return arr.sort((a, b) => b.reviews - a.reviews)
            default:
                return arr
        }
    }

    return {
        categories,
        products,
        productById,
        productsByCategory,
        categoryBySlug,
        searchProducts,
        sortProducts,
    }
}
