/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans"', '"Noto Sans SC"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['"Noto Serif"', '"Noto Serif SC"', 'Georgia', 'serif'],
      },
      // Color system in OKLCH. The `<alpha-value>` placeholder lets Tailwind
      // apply opacity utilities like `bg-parchment-100/40`. All neutrals are
      // tinted toward the brand hue (~80, warm yellow-tan); chroma is reduced
      // at lightness extremes (50, 900) per the perceptual rule that high
      // chroma at the edges looks garish.
      colors: {
        parchment: {
          50:  'oklch(0.992 0.004 80 / <alpha-value>)',
          100: 'oklch(0.965 0.008 80 / <alpha-value>)',
          200: 'oklch(0.928 0.011 80 / <alpha-value>)',
          300: 'oklch(0.890 0.013 80 / <alpha-value>)',
          400: 'oklch(0.795 0.012 80 / <alpha-value>)',
          500: 'oklch(0.660 0.012 80 / <alpha-value>)',
          600: 'oklch(0.460 0.013 80 / <alpha-value>)',
          700: 'oklch(0.290 0.013 80 / <alpha-value>)',
          800: 'oklch(0.210 0.011 80 / <alpha-value>)',
          900: 'oklch(0.140 0.008 80 / <alpha-value>)',
        },
        // Action accent — used for the Send button and other primary actions.
        // Single hue (cool blue, ~265) consistent across steps; chroma scaled
        // with lightness.
        ink: {
          DEFAULT: 'oklch(0.42 0.165 265)',
          50:  'oklch(0.96 0.020 265 / <alpha-value>)',
          100: 'oklch(0.92 0.038 265 / <alpha-value>)',
          200: 'oklch(0.84 0.078 265 / <alpha-value>)',
          600: 'oklch(0.42 0.165 265 / <alpha-value>)',
          700: 'oklch(0.34 0.150 265 / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
