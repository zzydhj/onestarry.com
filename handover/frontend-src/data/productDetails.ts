/**
 * Rich product detail for the PDP.
 * Pure, deterministic builders that turn a catalog `Product` into everything the
 * detail page needs (long description, highlights, spec table, variants, reviews,
 * bundle, ETA). Automotive products additionally get OE / cross-reference /
 * vehicle-fitment data (the "hybrid" behaviour). No UI here — pages read this.
 */
import type { Product } from './products'
import { productById, productsByCategory } from './products'
import { categoryBySlug } from './categories'
import { importedProduct, importedSpecs, importedDesc, importedColors, importedSizes } from './imported'

export interface Fit {
    mk: string
    md: string
    y: string
    en: string[]
}
export interface AutoDetail {
    oe: string
    alt: string[]
    quality: 'OE' | 'OEM' | 'AF'
    fits: Fit[]
    moq: number
    weight: string
    pkg: string
}
export interface Variant {
    name: string
    options: string[]
}
export interface Review {
    who: string
    stars: number
    title: string
    text: string
    when: string
    verified: boolean
}
export interface Detail {
    desc: string
    /** optional long-form, multi-paragraph copy (renders above the highlights) */
    paragraphs?: string[]
    highlights: string[]
    specs: [string, string][]
    variants: Variant[]
    reviews: Review[]
    breakdown: [number, number][]
    bundle: Product[]
    eta: string
    auto?: AutoDetail
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

const CAT_INFO: Record<string, { hl: string[]; spec: [string, string][]; variants: Variant[]; eta: string }> = {
    electronics: {
        hl: ['Ships next business day', '1-year manufacturer warranty', '30-day free returns', 'Real reviews from verified buyers'],
        spec: [['Connectivity', 'Bluetooth 5.3'], ['In the box', 'Device, USB-C cable, quick guide'], ['Warranty', '12 months']],
        variants: [{ name: 'Colour', options: ['Black', 'Silver', 'Midnight Blue'] }],
        eta: 'Arrives in 2–4 business days',
    },
    fashion: {
        hl: ['Premium breathable fabric', 'True-to-size fit guide', 'Machine washable', '30-day free returns'],
        spec: [['Material', 'Cotton blend'], ['Care', 'Machine wash cold'], ['Fit', 'Regular']],
        variants: [{ name: 'Size', options: ['S', 'M', 'L', 'XL'] }, { name: 'Colour', options: ['Black', 'Navy', 'Beige'] }],
        eta: 'Arrives in 3–5 business days',
    },
    home: {
        hl: ['Durable & easy to clean', 'Free shipping over $75', '5-star verified buyers', '30-day returns'],
        spec: [['Material', 'Sustainable mix'], ['Assembly', 'Tool-free, 10 min'], ['Care', 'Wipe clean']],
        variants: [{ name: 'Colour', options: ['White', 'Grey', 'Walnut'] }],
        eta: 'Arrives in 3–6 business days',
    },
    automotive: {
        hl: ['Trusted brand quality', 'Direct fit, no modification', 'Inspected before shipping', '12-month warranty'],
        spec: [['Placement', 'Direct OE replacement'], ['Sold as', 'Each / set'], ['Warranty', '12 months']],
        variants: [],
        eta: 'Ships in 24h · arrives 2–5 days',
    },
    beauty: {
        hl: ['Cruelty-free formula', 'Dermatologist tested', 'Free of parabens & sulfates', 'Satisfaction guaranteed'],
        spec: [['Size', 'Standard'], ['Skin type', 'All'], ['Shelf life', '24 months']],
        variants: [{ name: 'Size', options: ['30 ml', '50 ml', '100 ml'] }],
        eta: 'Arrives in 2–4 business days',
    },
    sports: {
        hl: ['Built to last', 'Ergonomic comfort', 'Free shipping over $75', '30-day returns'],
        spec: [['Use', 'Indoor & outdoor'], ['Weight', 'Lightweight'], ['Warranty', '12 months']],
        variants: [{ name: 'Size', options: ['One size', 'Large'] }],
        eta: 'Arrives in 3–5 business days',
    },
    toys: {
        hl: ['Safe, non-toxic materials', 'Fun for the whole family', 'Great gift idea', '12-month warranty'],
        spec: [['Age', '6+ years'], ['Material', 'BPA-free'], ['Battery', 'Not required']],
        variants: [],
        eta: 'Arrives in 2–4 business days',
    },
    grocery: {
        hl: ['Fresh stock, fast rotation', 'No artificial preservatives', 'Resealable packaging', 'Free shipping over $75'],
        spec: [['Net weight', 'Standard'], ['Storage', 'Cool, dry place'], ['Best before', '12 months']],
        variants: [{ name: 'Pack', options: ['1 pack', '2 pack', 'Value pack'] }],
        eta: 'Arrives in 1–3 business days',
    },
}

const REVIEW_POOL: Omit<Review, 'when'>[] = [
    { who: 'Alex M.', stars: 5, title: 'Exactly as described', text: 'Arrived fast and well packaged. Quality is excellent, would buy again.', verified: true },
    { who: 'Priya K.', stars: 4, title: 'Great value for the price', text: 'Does what it promises. Packaging was solid, minor delay but fine overall.', verified: true },
    { who: 'Diego R.', stars: 5, title: 'Highly recommend', text: 'Works flawlessly and feels premium. Customer service replied within hours.', verified: true },
    { who: 'Mia T.', stars: 5, title: 'Perfect gift', text: 'Bought as a present, they loved it. Shipping was quicker than expected.', verified: false },
    { who: 'Chen W.', stars: 4, title: 'Solid, few nits', text: 'Good product but I wish it came with more accessories. Still worth it.', verified: true },
]
const WHEN = ['2 weeks ago', '1 month ago', '3 weeks ago', '2 months ago', '5 days ago']

/** automotive OE/fitment overrides */
const AUTO: Record<string, AutoDetail> = {
    a1: { oe: 'GAS-120W-CORD', alt: ['GAS120W', 'VAC-12V-HEPA'], quality: 'OEM', moq: 1, weight: '1.20 kg', pkg: '32×20×18 cm', fits: [{ mk: 'Universal', md: 'All cars', y: 'Any', en: ['12V socket'] }] },
    a2: { oe: 'H4-LED-6000K', alt: ['H4LEDBULB', '9003-LED'], quality: 'AF', moq: 1, weight: '0.30 kg', pkg: '18×12×6 cm', fits: [{ mk: 'Volkswagen', md: 'Golf VI', y: '2008–2013', en: ['2.0 TSI', '1.4 TSI'] }, { mk: 'Audi', md: 'A3 8P', y: '2004–2012', en: ['2.0 TFSI'] }, { mk: 'Skoda', md: 'Octavia II', y: '2004–2013', en: ['1.8 TSI'] }] },
    a3: { oe: 'DASH-4K-FRONTREAR', alt: ['DASHCAM4K', 'MDR-4200G'], quality: 'OEM', moq: 1, weight: '0.42 kg', pkg: '16×12×8 cm', fits: [{ mk: 'Universal', md: 'All cars', y: 'Any', en: ['12V / USB'] }] },
    a4: { oe: 'MAT-AW-4PC', alt: ['FLOORMAT-RUB', 'AWM-SET4'], quality: 'AF', moq: 1, weight: '6.80 kg', pkg: '70×45×10 cm', fits: [{ mk: 'Volkswagen', md: 'Tiguan', y: '2007–2016', en: ['2.0 TDI'] }, { mk: 'Audi', md: 'Q5', y: '2009–2017', en: ['2.0 TFSI'] }] },
    a5: { oe: 'OIL-5W30-5L', alt: ['VW50400-5L', 'SYN-5W30'], quality: 'OE', moq: 2, weight: '4.50 kg', pkg: '24×18×22 cm', fits: [{ mk: 'Volkswagen', md: 'Passat B7', y: '2010–2014', en: ['2.0 TDI', '2.0 TSI'] }, { mk: 'Audi', md: 'A4 B8', y: '2008–2015', en: ['2.0 TFSI'] }] },
    a6: { oe: 'JS-1500A-USB', alt: ['JUMPSTART1500', 'PWRBANK-1500'], quality: 'OEM', moq: 1, weight: '1.10 kg', pkg: '28×20×10 cm', fits: [{ mk: 'Universal', md: 'Up to 8L gas / 6L diesel', y: 'Any', en: ['12V'] }] },
}

/** long-form multi-paragraph descriptions, authored per product (used to stress-test sticky) */
const LONG_DESC: Record<string, string[]> = {
    f2: [
        'The Trailrunner is our do-everything everyday sneaker — a shoe that looks just as at home under a pair of jeans as it does on a light trail. We spent three years iterating on the last, the foam, and the outsole to land on something that feels broken-in from the very first wear rather than after a painful two-week break-in period.',
        'Up top, a breathable engineered-mesh upper wraps the foot in a soft, supportive hold. The open-knit structure pulls heat and moisture away from the toe box, so your feet stay cool on a long summer walk and warm enough when the temperature drops. Reinforced overlays at the heel and midfoot lock everything in place without adding bulk or weight.',
        'Underfoot sits a dual-density compression-moulded EVA midsole tuned for the sweet spot between plush cushioning and honest responsiveness. It absorbs the impact of concrete and pavement on city streets, then returns enough energy on toe-off that you never feel like you are running through mud. A removable 6 mm contoured footbed adds a layer of arch support and can be swapped for your own orthotics in seconds.',
        'The outsole is where the Trailrunner earns its name. A 3.5 mm multidirectional rubber lug pattern grips wet pavement, loose gravel, and grassy inclines with equal confidence, while the siped forefoot flexes naturally with your gait. In independent abrasion testing the compound held its edges for well over 800 kilometres before measurable wear — that is roughly a year of daily commuting and weekend hikes combined.',
        'Fit is true to size with a medium-width last that suits the majority of feet. If you are between sizes, or you plan to wear thicker hiking socks, we recommend sizing up by half. The padded collar and tongue distribute lace pressure evenly, eliminating the hot spots and tongue bite that plague cheaper sneakers, and the reinforced heel counter keeps your foot tracking straight mile after mile.',
        'Sustainability is woven through the whole build, not bolted on as a marketing afterthought. The upper contains 42 % recycled content by weight, the foam is blown using a nitrogen-reinforced process that traps no blowing agents, and the shoe ships in a recycled, fully recyclable box with no plastic window. Every pair is assembled in an audited facility that runs on 70 % renewable electricity.',
        'We know that buying footwear online is a leap of faith, which is why every Trailrunner order includes free two-way shipping and a 30-day wear test. Walk it, hike it, live in it — if it is not the right shoe for you, drop it back in the box, use the prepaid label, and we will refund you in full the moment it scans. No restocking fees, no interrogation, no fine print.',
        'Care is refreshingly simple. Brush off dried mud with a soft, stiff-bristled brush, spot-clean scuffs with a damp cloth and a drop of mild soap, and let the shoes air-dry away from direct heat. Never put them in a tumble dryer or leave them on a radiator, as sustained heat will break down the adhesives and deform the midsole foam over time.',
        'The Trailrunner has quietly become one of our highest-rated releases, with thousands of verified buyers logging everything from airport terminals to mountain switchbacks. Whether you want a single dependable pair that handles the commute, the gym, and the trailhead without a bag full of specialist shoes, or you simply love a clean, versatile silhouette, this is the one we would point you toward first.',
        'Backed by a full 12-month craftsmanship warranty against manufacturing defects and by a support team that actually answers, the Trailrunner is built to be the last everyday sneaker you have to think about choosing. Add your size and colour to the cart, and we will have it on your doorstep within a few business days.',
    ],
}

function buildReviews(p: Product): Review[] {
    const start = hash(p.id) % REVIEW_POOL.length
    return [0, 1, 2].map((i) => ({ ...REVIEW_POOL[(start + i) % REVIEW_POOL.length], when: WHEN[(start + i) % WHEN.length] }))
}

function buildBreakdown(rating: number): [number, number][] {
    const r = Math.round(rating * 2) / 2
    const five = Math.min(94, Math.round((r - 1) * 25))
    return [
        [5, five],
        [4, Math.round((100 - five) * 0.6)],
        [3, Math.round((100 - five) * 0.25)],
        [2, 4],
        [1, Math.max(2, 100 - five - Math.round((100 - five) * 0.6) - Math.round((100 - five) * 0.25) - 4)],
    ]
}

export function buildDetail(p: Product): Detail {
    const info = CAT_INFO[p.category] ?? CAT_INFO.electronics
    const catName = categoryBySlug(p.category)?.name ?? p.category

    // imported product: real spec table + authored long description + real options
    if (p.id === importedProduct.id) {
        return {
            desc: importedDesc[0],
            paragraphs: importedDesc,
            highlights: [
                'High-gloss pearl-shimmer resin, smooth thin rim',
                '23 colourways to match or contrast any shirt',
                '3 diameters (10 / 11 / 13 mm), 10- or 20-packs',
                'Every pack includes a needle & matching thread',
            ],
            specs: [
                ['Brand', p.brand],
                ['Department', catName],
                ['Type', p.sub],
                ['Item SKU', 'OS-TB1'],
                ['Availability', `${p.stock} in stock`],
                ...importedSpecs,
            ],
            variants: [
                { name: 'Colour', options: importedColors.map((c) => c.name) },
                { name: 'Size', options: importedSizes.map((s) => s.name) },
            ],
            reviews: buildReviews(p),
            breakdown: buildBreakdown(p.rating),
            bundle: productsByCategory(p.category).filter((x) => x.id !== p.id).slice(0, 3),
            eta: 'Arrives in 3–5 business days',
        }
    }

    const specs: [string, string][] = [
        ['Brand', p.brand],
        ['Department', catName],
        ['Type', p.sub],
        ['Item SKU', 'OS-' + p.id.toUpperCase().padStart(5, '0')],
        ['Availability', p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'],
        ...info.spec,
    ]

    const bundle = productsByCategory(p.category)
        .filter((x) => x.id !== p.id)
        .slice(0, 3)

    return {
        desc:
            `${p.blurb}. ` +
            `A fan favourite in ${catName}, the ${p.brand} ${p.name} combines dependable build quality with everyday practicality. ` +
            `Every unit is checked before dispatch and backed by our 30-day money-back guarantee, so you can order with total confidence.`,
        paragraphs: LONG_DESC[p.id],
        highlights: info.hl,
        specs,
        variants: info.variants,
        reviews: buildReviews(p),
        breakdown: buildBreakdown(p.rating),
        bundle,
        eta: info.eta,
        auto: AUTO[p.id],
    }
}

export { productById }
