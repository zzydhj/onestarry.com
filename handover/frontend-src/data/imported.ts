/**
 * Imported real-world product (Taobao export → normalised into our catalogue).
 * Single source of truth for this item: the catalog Product row, its real gallery
 * photos, its spec table, and — crucially — the SKU source (23 colours each with
 * a REAL photo × 6 sizes each with its OWN price). skus.ts / productDetails.ts /
 * productImage.ts all read from here by product id, so nothing is duplicated.
 */
import type { Product } from './products'

export interface ImportedColor {
    name: string
    image: string
}
export interface ImportedSize {
    name: string
    price: number
}

export const importedProduct: Product = {
    id: 'tb1',
    name: 'Resin Colour Shirt Buttons · Slim Rim (10–13 mm)',
    brand: 'Duoduo 朵朵',
    category: 'fashion',
    sub: 'Sewing & Buttons',
    price: 5.8,
    rating: 4.8,
    reviews: 5000,
    glyph: '🔘',
    badge: 'best',
    stock: 200,
    blurb: 'Pearl-shimmer thin-rim resin buttons for shirts and polos — 23 colours, 3 diameters, every pack includes a needle & thread kit.',
}

// real product photos (the 5 catalogue images from the export)
export const importedImages: string[] = [
    'https://img.alicdn.com/imgextra/i2/2212788676105/O1CN01WIe8is1uy8vsHNRjt~crop,100,0,600,800~_!!2212788676105.png',
    'https://img.alicdn.com/imgextra/i4/2212788676105/O1CN01RE6kA81uy8vr1Se13~crop,100,0,600,800~_!!2212788676105.png',
    'https://img.alicdn.com/imgextra/i4/2212788676105/O1CN01ZZjw2z1uy8vmwoxE0~crop,100,0,600,800~_!!2212788676105.png',
    'https://img.alicdn.com/imgextra/i3/2212788676105/O1CN01rv5uhZ1uy8vrA5JEG~crop,100,0,600,800~_!!2212788676105.png',
    'https://img.alicdn.com/imgextra/i2/2212788676105/O1CN01zNmgQO1uy95dAuEDi_!!2212788676105.png',
]

export const importedSpecs: [string, string][] = [
    ['Style No.', '珠光细边纽扣 (pearl slim-rim)'],
    ['Material', 'High-gloss resin'],
    ['Diameters', '10 mm · 11 mm · 13 mm'],
    ['Pack size', '10 or 20 buttons'],
    ['Includes', 'Needle & thread kit'],
    ['Origin', 'Wenzhou, Zhejiang, China'],
    ['Sold', '5000+ units'],
    ['Source', 'Taobao item 786671837251'],
]

export const importedDesc: string[] = [
    'A pack of high-gloss resin shirt buttons with a refined thin rim and a soft pearl shimmer — the small upgrade that makes a handmade or repaired garment look factory-finished. Each button is smoothly moulded with a clean 2-hole face and a flat back, so it sits flush against the fabric and sews on without fuss.',
    'Available in three diameters (10 mm, 11 mm and 13 mm) and a choice of 10- or 20-button packs, in 23 colourways ranging from everyday black, white and grey to jewel tones like sapphire, burgundy and forest green. Pick the diameter to match your shirt placket or cuff, and the colour to match or contrast the cloth. Every pack ships with a complimentary needle and matching thread so you can start sewing straight away.',
    'These are a true universal fit for shirts, polos, blouses, pyjamas and light knitwear, and the resin construction is durable enough for machine washing (cold, gentle). Because pricing scales with diameter and pack size, larger buttons and 20-packs cost a little more — select your combination to see its live price and stock.',
]

// 23 colours, each with its real swatch photo (from skuProps.颜色分类)
export const importedColors: ImportedColor[] = [
    { name: '粉色 Pink', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01ykMcJL1uy8vozBDAb_!!2212788676105.png' },
    { name: '草绿色 Grass Green', image: 'https://gw.alicdn.com/bao/uploaded/i2/2212788676105/O1CN01YKoNHs1uy8vtg4Z86_!!2212788676105.png' },
    { name: '黄色 Yellow', image: 'https://gw.alicdn.com/bao/uploaded/i1/2212788676105/O1CN01W5WkaP1uy8vhU7WCQ_!!2212788676105.png' },
    { name: '暗橘色 Dark Orange', image: 'https://gw.alicdn.com/bao/uploaded/i3/2212788676105/O1CN01yk2ZhL1uy8vozBwvv_!!2212788676105.png' },
    { name: '米色 Beige', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01DP6kYv1uy8vmwjqxx_!!2212788676105.png' },
    { name: '灰色 Grey', image: 'https://gw.alicdn.com/bao/uploaded/i3/2212788676105/O1CN01cEO5Ix1uy8vsHJLok_!!2212788676105.png' },
    { name: '白色 White', image: 'https://gw.alicdn.com/bao/uploaded/i1/2212788676105/O1CN01BudwsB1uy8vmwjJif_!!2212788676105.png' },
    { name: '宝蓝色 Royal Blue', image: 'https://gw.alicdn.com/bao/uploaded/i3/2212788676105/O1CN01mWnmlw1uy8votTDVO_!!2212788676105.png' },
    { name: '紫色 Purple', image: 'https://gw.alicdn.com/bao/uploaded/i2/2212788676105/O1CN012Z4juj1uy8vsHJLny_!!2212788676105.png' },
    { name: '浅绿色 Light Green', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01F93zIf1uy8vryXR7i_!!2212788676105.png' },
    { name: '玫红色 Rose Red', image: 'https://gw.alicdn.com/bao/uploaded/i3/2212788676105/O1CN01WoG00O1uy8vsHHo78_!!2212788676105.png' },
    { name: '墨绿色 Dark Green', image: 'https://gw.alicdn.com/bao/uploaded/i2/2212788676105/O1CN01ko5mf61uy8vr1N4dQ_!!2212788676105.png' },
    { name: '红色 Red', image: 'https://gw.alicdn.com/bao/uploaded/i2/2212788676105/O1CN016aZECm1uy8vpB2rjm_!!2212788676105.png' },
    { name: '咖啡色 Coffee', image: 'https://gw.alicdn.com/bao/uploaded/i1/2212788676105/O1CN0141ntwu1uy8vryWtrW_!!2212788676105.png' },
    { name: '深绿色 Deep Green', image: 'https://gw.alicdn.com/bao/uploaded/i2/2212788676105/O1CN01OOrgZE1uy8vpecvbH_!!2212788676105.png' },
    { name: '橘色 Orange', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01WbUzQX1uy8vrA31YO_!!2212788676105.png' },
    { name: '浅蓝色 Light Blue', image: 'https://gw.alicdn.com/bao/uploaded/i3/2212788676105/O1CN01asPUpw1uy8voz8OY2_!!2212788676105.png' },
    { name: '肉粉色 Flesh Pink', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01yov5dO1uy8vpebr4d_!!2212788676105.png' },
    { name: '湖蓝色 Lake Blue', image: 'https://gw.alicdn.com/bao/uploaded/i1/2212788676105/O1CN01NB6Jm41uy8vm0NZYR_!!2212788676105.png' },
    { name: '暗红色 Dark Red', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01o3SMzn1uy8vr1LjR2_!!2212788676105.png' },
    { name: '深紫色 Deep Purple', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN01iqr3S61uy8vqYsIA2_!!2212788676105.png' },
    { name: '深蓝色 Deep Blue', image: 'https://gw.alicdn.com/bao/uploaded/i4/2212788676105/O1CN012UWmrE1uy8vqYrxM2_!!2212788676105.png' },
    { name: '黑色 Black', image: 'https://gw.alicdn.com/bao/uploaded/i3/2212788676105/O1CN01MKthFS1uy8vpB4PQL_!!2212788676105.png' },
]

// 6 size/pack combinations, each with its own real price (from skus)
export const importedSizes: ImportedSize[] = [
    { name: '10 mm · 10 pcs', price: 5.8 },
    { name: '10 mm · 20 pcs', price: 7.8 },
    { name: '11 mm · 10 pcs', price: 6.8 },
    { name: '11 mm · 20 pcs', price: 8.8 },
    { name: '13 mm · 10 pcs', price: 7.8 },
    { name: '13 mm · 20 pcs', price: 9.8 },
]
