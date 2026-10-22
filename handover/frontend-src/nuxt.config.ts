export default defineNuxtConfig({
    compatibilityDate: '2024-11-01',
    devtools: { enabled: false },

    modules: ['@nuxtjs/tailwindcss'],

    // Register every component by its file name (no folder prefix), so nested
    // ones like components/product/SkuPicker are used as <SkuPicker>.
    components: [{ path: '~/components', pathPrefix: false }],

    app: {
        head: {
            title: 'Onestarry — Everything you need, one cart',
            meta: [
                { charset: 'utf-8' },
                { name: 'viewport', content: 'width=device-width, initial-scale=1' },
                {
                    name: 'description',
                    content:
                        'Onestarry is a multi-category online marketplace: electronics, fashion, home, automotive, beauty and more.',
                },
            ],
            link: [
                { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
                { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
                { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
                {
                    rel: 'stylesheet',
                    href: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap',
                },
            ],
        },
    },

    tailwindcss: {
        cssPath: '~/assets/css/main.css',
        viewer: false,
    },
})
