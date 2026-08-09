/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Industrial navy / charcoal shell
        navy: {
          50: '#f2f5fa',
          100: '#e2e8f2',
          200: '#c6d1e4',
          300: '#9aadcd',
          400: '#6781b0',
          500: '#456096',
          600: '#34497b',
          700: '#2a3a63',
          800: '#1B2537',
          900: '#131C2B',
          950: '#0B1220',
        },
        steel: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b1bbcb',
          400: '#8695ad',
          500: '#677793',
          600: '#525f79',
          700: '#434e63',
          800: '#3a4353',
          900: '#333a47',
        },
        // Automotive hazard yellow / gold accent
        amberline: {
          50: '#fffbea',
          100: '#fff3c4',
          200: '#fce588',
          300: '#fadb5f',
          400: '#F7C948',
          500: '#F0B429',
          600: '#DE911D',
          700: '#CB6E17',
          800: '#B44D12',
          900: '#8D2B0B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)',
        lift: '0 10px 30px -12px rgba(11,18,32,.35)',
        panel: '0 20px 60px -20px rgba(11,18,32,.55)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'slide-up': {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: 0, transform: 'translateX(24px)' },
          '100%': { opacity: 1, transform: 'translateX(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'scan-line': { '0%': { top: '4%' }, '100%': { top: '96%' } },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
        'slide-in-right': 'slide-in-right .25s cubic-bezier(.2,.8,.2,1)',
        'scan-line': 'scan-line 2s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
}
