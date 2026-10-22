/**
 * Mock product catalogue for the UI build.
 * Shape mirrors what the real Neon-backed API will return later, so pages can
 * swap `useCatalog()` to a `useFetch()` without touching templates.
 */
import { categories } from './categories'
import { importedProduct } from './imported'

export type Badge = 'new' | 'sale' | 'best' | ''

export interface Product {
    id: string
    name: string
    brand: string
    category: string // category slug
    sub: string
    price: number
    compareAt?: number
    priceRange?: [number, number] // set when the product's SKUs span multiple prices → cards show a range
    rating: number
    reviews: number
    glyph: string // emoji stand-in for product photo
    badge: Badge
    stock: number
    blurb: string
}

/** compact tuple -> Product, keeps the seed list readable */
type Row = [
    id: string,
    name: string,
    brand: string,
    category: string,
    sub: string,
    price: number,
    compareAt: number,
    rating: number,
    reviews: number,
    glyph: string,
    badge: Badge,
    stock: number,
    blurb: string,
]

const rows: Row[] = [
    // Electronics
    ['e1', 'Pulse 5G Smartphone 128GB', 'Nexon', 'electronics', 'Smartphones', 499, 599, 4.6, 2841, '📱', 'best', 120, '6.5" AMOLED, 120Hz, triple 50MP camera, 4500mAh'],
    ['e2', 'Aura Wireless Earbuds Pro', 'Soundio', 'electronics', 'Audio', 89, 129, 4.5, 5120, '🎧', 'sale', 300, 'Active noise cancelling, 32h case, IPX5'],
    ['e3', 'Volt 14" Ultrabook 16GB/512GB', 'Nexon', 'electronics', 'Laptops', 899, 999, 4.7, 980, '💻', '', 60, 'Intel core i5, 1920×1200, 18h battery, 1.2kg'],
    ['e4', 'Beam 4K Smart TV 55"', 'Vuzview', 'electronics', 'TV & Video', 429, 549, 4.4, 1502, '📺', 'sale', 40, 'Dolby Vision, HDR10+, built-in streaming'],
    ['e5', 'HomeHub Smart Speaker', 'Soundio', 'electronics', 'Smart Home', 59, 0, 4.3, 3210, '🔊', 'new', 500, 'Voice assistant, multi-room audio, zigbee bridge'],
    ['e6', 'FastCharge 65W GaN Charger', 'Voltpack', 'electronics', 'Accessories', 29, 39, 4.8, 8800, '🔌', 'best', 900, '3-port, folds flat, laptop + phone in one'],
    ['e7', 'ActionCam 4K Waterproof', 'Vuzview', 'electronics', 'TV & Video', 119, 159, 4.2, 640, '📷', '', 150, 'Gyro stabilised, 10m housing, touch screen'],
    ['e8', 'Mech Keyboard 75% Hot-swap', 'Keytron', 'electronics', 'Accessories', 79, 0, 4.7, 2210, '⌨️', 'new', 210, 'Gasket mount, wireless, per-key RGB'],

    // Fashion
    ['f1', 'Everyday Cotton Tee (3-Pack)', 'Northloop', 'fashion', "Men's Clothing", 24, 36, 4.4, 6120, '👕', 'sale', 800, 'Breathable 180gsm, pre-shrunk, regular fit'],
    ['f2', 'Trailrunner Sneakers', 'Stridewell', 'fashion', 'Shoes', 74, 95, 4.6, 3310, '👟', 'best', 260, 'Cushioned EVA midsole, grippy outsole'],
    ['f3', 'Alpine Down Jacket', 'Northloop', 'fashion', "Women's Clothing", 129, 179, 4.7, 1450, '🧥', 'sale', 130, '700-fill hydrophobic down, packable'],
    ['f4', 'Canvas Weekender Bag', 'Voyage & Co', 'fashion', 'Bags', 58, 0, 4.3, 890, '🧳', '', 210, 'Water-repellent, laptop sleeve, trolley strap'],
    ['f5', 'Minimalist Quartz Watch', 'Chrono & Co', 'fashion', 'Watches', 99, 139, 4.5, 1120, '⌚', 'sale', 175, 'Sapphire glass, 42mm, genuine leather strap'],
    ['f6', 'Sterling Silver Chain', 'Lumière', 'fashion', 'Jewellery', 45, 0, 4.2, 560, '📿', 'new', 320, '925 silver, 45cm, tarnish resistant'],
    ['f7', 'Merino Crew Socks (4)', 'Stridewell', 'fashion', "Men's Clothing", 28, 0, 4.6, 2400, '🧦', '', 540, 'Temperature regulating, blister-free'],
    ['f8', 'Denim Trucker Jacket', 'Northloop', 'fashion', "Women's Clothing", 89, 0, 4.4, 730, '🧥', 'best', 150, 'Rigid selvedge denim, classic fit'],

    // Home & Living
    ['h1', 'Cloud Foam Pillow (2)', 'Dreamerz', 'home', 'Bedding', 39, 55, 4.5, 4100, '🛏️', 'sale', 400, 'Cooling gel memory foam, washable cover'],
    ['h2', 'Cast Iron Skillet 26cm', 'Hearth & Iron', 'home', 'Kitchen', 34, 0, 4.8, 6700, '🍳', 'best', 260, 'Pre-seasoned, oven-safe to 260°C'],
    ['h3', 'Oak Bookshelf 5-Tier', 'Formhaus', 'home', 'Furniture', 149, 199, 4.4, 620, '🪑', 'sale', 45, 'Solid oak veneer, anti-tip kit included'],
    ['h4', 'Aroma Ultrasonic Diffuser', 'Lumen Living', 'home', 'Decor', 27, 0, 4.3, 2900, '🕯️', 'new', 330, '300ml, 7-colour night light, auto-off'],
    ['h5', 'Matte Black Floor Lamp', 'Lumen Living', 'home', 'Lighting', 69, 89, 4.5, 810, '💡', '', 120, 'Dimmable, 152cm, foot switch'],
    ['h6', 'Ceramic Dinner Set (16pc)', 'Hearth & Iron', 'home', 'Kitchen', 79, 110, 4.6, 1300, '🍽️', 'sale', 90, 'Reactive glaze, dishwasher & microwave safe'],
    ['h7', 'Solar Garden Lights (6)', 'Lumen Living', 'home', 'Garden', 32, 0, 4.2, 3400, '🌞', 'best', 500, 'Warm white, IP65, auto dawn sensor'],
    ['h8', 'Weighted Blanket 7kg', 'Dreamerz', 'home', 'Bedding', 59, 79, 4.7, 5200, '🛌', 'sale', 180, 'Breathable cotton, glass-bead fill'],

    // Automotive
    ['a1', 'Car Vacuum 120W Cordless', 'DrivePro', 'automotive', 'Tools', 49, 65, 4.3, 1900, '🚗', 'sale', 300, 'HEPA filter, crevice tools, 30min runtime'],
    ['a2', 'LED Headlight Bulbs H4 (pair)', 'Beamline', 'automotive', 'Exterior', 39, 55, 4.5, 2600, '💡', 'best', 420, '6000K, CANbus-ready, plug-and-play'],
    ['a3', 'Dash Cam 4K Front+Rear', 'Vuzview', 'automotive', 'Electronics', 89, 119, 4.4, 980, '📹', '', 150, 'Parking mode, GPS, 2.7" screen'],
    ['a4', 'All-Weather Floor Mats', 'DrivePro', 'automotive', 'Interior', 54, 0, 4.6, 1350, '🧶', 'new', 220, 'Deep-dish rubber, anti-slip backing'],
    ['a5', 'Synthetic Motor Oil 5L 5W-30', 'Fluidex', 'automotive', 'Fluids', 38, 0, 4.8, 4200, '🛢️', 'best', 600, 'Full synthetic, long-drain protection'],
    ['a6', 'Jump Starter 1500A Power Bank', 'Voltpack', 'automotive', 'Tools', 69, 95, 4.5, 2100, '🔋', 'sale', 260, 'Starts 8L gas, USB-C, LED torch'],

    // Beauty & Health
    ['b1', 'Vitamin C Brightening Serum', 'PureLab', 'beauty', 'Skincare', 22, 30, 4.6, 8100, '🧴', 'best', 500, '15% ascorbic acid, hyaluronic acid'],
    ['b2', 'Hyaluronic Moisturiser 50ml', 'PureLab', 'beauty', 'Skincare', 18, 0, 4.5, 6200, '🧴', 'new', 620, 'Lightweight, non-greasy, ceramides'],
    ['b3', 'Ionic Hair Brush', 'Glamtech', 'beauty', 'Hair Care', 34, 45, 4.2, 1900, '💇', 'sale', 300, 'Anti-frizz, 3 heat levels, auto-shutoff'],
    ['b4', 'Eau de Parfum 50ml', 'Lumière', 'beauty', 'Fragrance', 59, 0, 4.7, 780, '🌸', 'best', 160, 'Amber & jasmine, 8h wear'],
    ['b5', 'Electric Toothbrush Sonic 5000', 'Brightsmile', 'beauty', 'Tools', 45, 65, 4.5, 5400, '🪥', 'sale', 380, '5 modes, 30-day battery, travel case'],
    ['b6', 'Collagen Peptides 300g', 'Wellwork', 'beauty', 'Wellness', 26, 0, 4.3, 2600, '🥤', '', 450, 'Hydrolysed type I & III, unflavoured'],

    // Sports & Outdoors
    ['s1', 'Adjustable Dumbbell 24kg', 'Ironwill', 'sports', 'Fitness', 129, 169, 4.7, 1800, '🏋️', 'best', 90, 'Dial from 2–24kg, space-saving pair'],
    ['s2', '4-Season Sleeping Bag', 'Basecamp', 'sports', 'Camping', 69, 0, 4.4, 980, '⛺', '', 150, 'Mummy cut, -5°C rating, stuff sack'],
    ['s3', 'Road Cycling Helmet', 'Velo', 'sports', 'Cycling', 79, 99, 4.6, 640, '🚴', 'sale', 210, 'In-mould, 22 vents, MIPS protection'],
    ['s4', 'Carbon Trekking Poles (pair)', 'Basecamp', 'sports', 'Camping', 49, 0, 4.5, 720, '🥾', 'new', 260, 'Ultralight carbon, quick-lock, 5 grips'],
    ['s5', 'Insulated Water Bottle 1L', 'Ironwill', 'sports', 'Fitness', 24, 0, 4.8, 9200, '🧴', 'best', 900, '24h cold / 12h hot, leakproof lid'],
    ['s6', 'Yoga Mat Pro 6mm', 'Zenflow', 'sports', 'Fitness', 32, 45, 4.6, 3400, '🧘', 'sale', 400, 'Non-slip TPE, alignment lines, strap'],

    // Toys & Games
    ['t1', 'Building Blocks 1000pc Set', 'Bricko', 'toys', 'Building Sets', 45, 60, 4.7, 2600, '🧱', 'sale', 300, 'Compatible bricks, storage box, ideas book'],
    ['t2', 'Strategy Board Game', 'MeepleWorks', 'toys', 'Board Games', 34, 0, 4.8, 4100, '🎲', 'best', 220, '2–4 players, 60min, award-winning'],
    ['t3', 'RC Stunt Car 4WD', 'ZoomRC', 'toys', 'RC & Drones', 59, 79, 4.3, 1300, '🚙', 'sale', 180, '2.4GHz, flips 360°, rechargeable'],
    ['t4', '1000pc Jigsaw Puzzle', 'MeepleWorks', 'toys', 'Puzzles', 16, 0, 4.6, 2100, '🧩', '', 500, 'Matte finish, poster included'],
    ['t5', 'Plush Bear XL 60cm', 'Cuddle & Co', 'toys', 'Toys', 29, 0, 4.7, 3300, '🧸', 'new', 340, 'Ultra-soft, machine washable'],

    // Grocery
    ['g1', 'Single-Origin Coffee Beans 1kg', 'Roast & Co', 'grocery', 'Coffee & Tea', 21, 26, 4.7, 5600, '☕', 'best', 400, 'Medium roast, arabica, notes of cocoa'],
    ['g2', 'Organic Matcha Powder 100g', 'Zenleaf', 'grocery', 'Coffee & Tea', 18, 0, 4.5, 1900, '🍵', 'new', 300, 'Ceremonial grade, stone-ground'],
    ['g3', 'Mixed Nuts 1kg', 'Daily Harvest', 'grocery', 'Snacks', 15, 19, 4.6, 3400, '🥜', 'sale', 600, 'Salted & roasted, resealable'],
    ['g4', 'Sparkling Water 24×330ml', 'Clearspring', 'grocery', 'Beverages', 12, 0, 4.4, 2200, '🫧', '', 800, 'Zero sugar, natural minerals'],
    ['g5', 'Extra Virgin Olive Oil 1L', 'Daily Harvest', 'grocery', 'Pantry', 16, 0, 4.8, 4100, '🫒', 'best', 350, 'Cold-pressed, dark glass, 0.3% acidity'],
    ['g6', 'Paper Towels 6-Roll', 'Clearspring', 'grocery', 'Household', 9, 12, 4.3, 1600, '🧻', 'sale', 900, '2-ply, ultra-absorbent'],
]

export const products: Product[] = [
    ...rows.map(([id, name, brand, category, sub, price, compareAt, rating, reviews, glyph, badge, stock, blurb]) => ({
        id,
        name,
        brand,
        category,
        sub,
        price,
        ...(compareAt > 0 ? { compareAt } : {}),
        ...(id === 'f2' ? { priceRange: [3, 121] as [number, number] } : {}),
        rating,
        reviews,
        glyph,
        badge,
        stock,
        blurb,
    })),
    importedProduct,
]

export const productById = (id: string): Product | undefined =>
    products.find((p) => p.id === id)

export const productsByCategory = (slug: string): Product[] =>
    products.filter((p) => p.category === slug)

/** rough count per top category, for the mega menu + category tiles */
export const countByCategory = (slug: string): number =>
    products.filter((p) => p.category === slug).length

export const allCategoryNames = categories.map((c) => c.name)
