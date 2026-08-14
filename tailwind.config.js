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
        /* ---- mascot: one body, small state-dependent motions ---- */
        'mascot-bob': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        'mascot-breathe': {
          '0%,100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.03)' },
        },
        'mascot-wave': {
          '0%,100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-16deg)' },
          '75%': { transform: 'rotate(14deg)' },
        },
        'mascot-blink': {
          '0%,92%,100%': { transform: 'scaleY(1)' },
          '96%': { transform: 'scaleY(.1)' },
        },
        'mascot-shake': {
          '0%,100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-2.5px)' },
          '40%': { transform: 'translateX(2.5px)' },
          '60%': { transform: 'translateX(-1.5px)' },
          '80%': { transform: 'translateX(1.5px)' },
        },
        'mascot-beam': {
          '0%,100%': { opacity: '.35', transform: 'scaleX(.92)' },
          '50%': { opacity: '1', transform: 'scaleX(1)' },
        },
        'mascot-zzz': {
          '0%': { opacity: '0', transform: 'translate(0,2px) scale(.7)' },
          '35%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translate(6px,-14px) scale(1.1)' },
        },
        'mascot-spark': {
          '0%,100%': { opacity: '.25', transform: 'scale(.75)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
        },
        'mascot-spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'mascot-pop': {
          '0%': { transform: 'translateY(0) scale(1)' },
          '35%': { transform: 'translateY(-7px) scale(1.05)' },
          '70%': { transform: 'translateY(1px) scale(.98)' },
          '100%': { transform: 'translateY(0) scale(1)' },
        },
        'mascot-tilt': {
          '0%,100%': { transform: 'rotate(-5deg)' },
          '50%': { transform: 'rotate(5deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
        'slide-in-right': 'slide-in-right .25s cubic-bezier(.2,.8,.2,1)',
        'scan-line': 'scan-line 2s ease-in-out infinite alternate',
        'mascot-bob': 'mascot-bob 3s ease-in-out infinite',
        'mascot-bob-fast': 'mascot-bob 1.1s ease-in-out infinite',
        'mascot-breathe': 'mascot-breathe 3.4s ease-in-out infinite',
        'mascot-wave': 'mascot-wave 1.6s ease-in-out infinite',
        'mascot-blink': 'mascot-blink 5s ease-in-out infinite',
        'mascot-shake': 'mascot-shake 2.6s ease-in-out infinite',
        'mascot-beam': 'mascot-beam 1.1s ease-in-out infinite',
        'mascot-zzz': 'mascot-zzz 2.4s ease-in-out infinite',
        'mascot-spark': 'mascot-spark 1.4s ease-in-out infinite',
        'mascot-spin-slow': 'mascot-spin-slow 9s linear infinite',
        'mascot-tilt': 'mascot-tilt 2.8s ease-in-out infinite',
        'mascot-pop': 'mascot-pop .5s cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
}
