/**
 * Category taxonomy for the marketplace.
 * `subs` feed the mega menu and the category sidebar.
 * Add / rename categories here only — the UI reads from this single source.
 */
export interface Category {
    slug: string
    name: string
    icon: string
    blurb: string
    subs: string[]
}

export const categories: Category[] = [
    {
        slug: 'electronics',
        name: 'Electronics',
        icon: '📱',
        blurb: 'Phones, audio, computing & smart home',
        subs: ['Smartphones', 'Laptops', 'Audio', 'TV & Video', 'Smart Home', 'Accessories'],
    },
    {
        slug: 'fashion',
        name: 'Fashion',
        icon: '👕',
        blurb: 'Men, women, shoes & bags',
        subs: ["Men's Clothing", "Women's Clothing", 'Shoes', 'Bags', 'Watches', 'Jewellery'],
    },
    {
        slug: 'home',
        name: 'Home & Living',
        icon: '🏠',
        blurb: 'Furniture, kitchen, decor & garden',
        subs: ['Furniture', 'Kitchen', 'Bedding', 'Decor', 'Lighting', 'Garden'],
    },
    {
        slug: 'automotive',
        name: 'Automotive',
        icon: '🚗',
        blurb: 'Parts, tools & car care',
        subs: ['Car Parts', 'Tools', 'Electronics', 'Exterior', 'Interior', 'Fluids'],
    },
    {
        slug: 'beauty',
        name: 'Beauty & Health',
        icon: '💄',
        blurb: 'Skincare, makeup & personal care',
        subs: ['Skincare', 'Makeup', 'Hair Care', 'Fragrance', 'Wellness', 'Tools'],
    },
    {
        slug: 'sports',
        name: 'Sports & Outdoors',
        icon: '⚽',
        blurb: 'Fitness, camping & cycling',
        subs: ['Fitness', 'Camping', 'Cycling', 'Fishing', 'Team Sports', 'Watersports'],
    },
    {
        slug: 'toys',
        name: 'Toys & Games',
        icon: '🧸',
        blurb: 'Toys, games & hobby',
        subs: ['Toys', 'Board Games', 'Building Sets', 'RC & Drones', 'Puzzles', 'Outdoor Play'],
    },
    {
        slug: 'grocery',
        name: 'Grocery',
        icon: '🛒',
        blurb: 'Pantry, drinks & daily needs',
        subs: ['Snacks', 'Beverages', 'Pantry', 'Coffee & Tea', 'Breakfast', 'Household'],
    },
]

export const categoryBySlug = (slug: string): Category | undefined =>
    categories.find((c) => c.slug === slug)
