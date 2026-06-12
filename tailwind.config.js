/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { accent: { DEFAULT: '#e8702a', hover: '#d2611f' } },
      fontFamily: {
        sans: ['"Noto Serif SC"', 'serif'],
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', 'serif'],
      },
    },
  },
  plugins: [],
};
