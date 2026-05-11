import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        // Sim-specific palette
        seir: {
          s: '#4a90d9',
          e: '#f39c12',
          ia: '#f1c40f',
          is: '#e74c3c',
          r: '#2ecc71',
        },
        building: {
          essential: '#5d6e8a',
          nonEssential: '#384353',
          bankrupt: '#171c23',
          struggle: '#ff8c1a',
          house: '#c8a97e',
          houseInfected: '#c87a6e',
          houseDark: '#3a3a3a',
          market: '#5dade2',
          hospital: '#f4f4f4',
          hospitalFlash: '#ff5050',
          hospitalCross: '#cc0000',
          unemp: '#b8941f',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'pulse-amber': {
          '0%, 100%': { borderColor: '#ff8c1a' },
          '50%': { borderColor: '#22293a' },
        },
      },
      animation: {
        'pulse-amber': 'pulse-amber 0.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
