import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          bg: '#000810',
          panel: '#0a1628',
          border: '#1a3a5c',
          glow: '#00aaff',
          green: '#00ff88',
          amber: '#ffaa00',
          red: '#ff4455',
          text: '#a0c4e0',
          dim: '#4a7a9a',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'flicker': 'flicker 4s ease-in-out infinite',
        'scan': 'scan 8s linear infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '92%': { opacity: '1' },
          '93%': { opacity: '0.6' },
          '94%': { opacity: '1' },
          '96%': { opacity: '0.7' },
          '97%': { opacity: '1' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      fontFamily: {
        mono: ['Share Tech Mono', 'Courier New', 'monospace'],
      },
      boxShadow: {
        'glow-blue': '0 0 12px rgba(0,170,255,0.5), 0 0 24px rgba(0,170,255,0.2)',
        'glow-green': '0 0 12px rgba(0,255,136,0.5), 0 0 24px rgba(0,255,136,0.2)',
        'glow-amber': '0 0 12px rgba(255,170,0,0.5)',
        'glow-red': '0 0 12px rgba(255,68,85,0.5)',
        'room': 'inset 0 0 30px rgba(0,170,255,0.05), 0 0 1px rgba(0,170,255,0.4)',
      },
    },
  },
  plugins: [],
}

export default config
