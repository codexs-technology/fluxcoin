/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#070b0e',
        cardBg: 'rgba(11, 18, 26, 0.85)',
        cardBorder: 'rgba(0, 240, 255, 0.18)',
        cyanGlow: '#00f0ff',
        greenGlow: '#00ff88',
        neonOrange: '#ff9900',
        neonRed: '#ff3366',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        display: ['Orbitron', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 240, 255, 0.35)',
        'glow-green': '0 0 20px rgba(0, 255, 136, 0.35)',
        'glow-orange': '0 0 20px rgba(255, 153, 0, 0.35)',
      }
    },
  },
  plugins: [],
}
