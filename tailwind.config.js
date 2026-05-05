/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans"', '"Noto Sans SC"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['"Noto Serif"', '"Noto Serif SC"', 'Georgia', 'serif'],
      },
      colors: {
        parchment: {
          50:  '#FDFCF9',
          100: '#F7F4EE',
          200: '#EDE9E0',
          300: '#E2DDD5',
          400: '#C8C4BC',
          500: '#A09890',
          600: '#6B6459',
          700: '#3D3930',
          800: '#2A2720',
          900: '#1A1814',
        },
        ink: {
          DEFAULT: '#2B4EAB',
          50:  '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          600: '#2B4EAB',
          700: '#1E3A8A',
        },
      },
    },
  },
  plugins: [],
}
