/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        dark: '#0f172a',
        card: '#1e293b',
        border: '#334155',
      },
    },
  },
  plugins: [],
}
