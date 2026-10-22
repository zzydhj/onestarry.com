import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: '#FFC400',
                    dark: '#E6AF00',
                    soft: '#FFF4CC',
                },
                ink: {
                    DEFAULT: '#111318',
                    2: '#1B1F27',
                    3: '#2a2f39',
                },
                line: '#E1E4E9',
                muted: '#5B6270',
                ok: '#1F8A4C',
                warn: '#C77700',
                danger: '#D92D27',
                link: '#1856C9',
                canvas: '#F4F5F7',
            },
            fontFamily: {
                display: ['"Barlow Condensed"', 'sans-serif'],
                sans: ['Inter', 'sans-serif'],
            },
            maxWidth: {
                shell: '1440px',
            },
            boxShadow: {
                card: '0 10px 26px rgba(0,0,0,.10)',
                pop: '0 14px 34px rgba(0,0,0,.25)',
            },
        },
    },
}
