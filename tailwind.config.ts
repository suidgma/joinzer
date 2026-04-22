import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#8FC919',
          hover: '#6EAF18',
          active: '#428609',
          dark: '#012D0B',
          soft: '#EEF6E3',
          border: '#DCE6D2',
          muted: '#4B5A46',
          body: '#1F2A1C',
          yellow: '#FDF077',
          surface: '#FEFEFE',
          page: '#F5F7F2',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
        heading: ['var(--font-manrope)', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
