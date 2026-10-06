/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './node_modules/streamdown/dist/**/*.{js,mjs}',
  ],
  safelist: ['w-6', 'w-7', 'w-8', 'w-9', 'w-10', 'w-11', 'w-12'],
  theme: {
    extend: {
      screens: {
        desktop: '936px',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'monospace'],
        'dm-sans': ['DM Sans', 'sans-serif'],
        'kumbh-sans': ['Kumbh Sans', 'sans-serif'],
      },
      colors: {
        'adam-bg-dark': 'rgb(var(--brepia-canvas) / <alpha-value>)',
        // ??? lol that's what its called in Figma!
        'adam-background-light': '#F1F1F1',
        'adam-bg-secondary-dark':
          'rgb(var(--brepia-surface-1) / <alpha-value>)',
        'adam-bg-light': '#E5E5E3',
        'adam-bg-secondary-light': '#ECECEB',
        'adam-blue': '#00A6FF',
        'adam-blue-dark': '#00A6FF',
        'adam-text-primary': 'rgb(var(--brepia-text-primary) / <alpha-value>)',
        'adam-text-secondary':
          'rgb(var(--brepia-text-secondary) / <alpha-value>)',
        'adam-text-tertiary':
          'rgb(var(--brepia-text-tertiary) / <alpha-value>)',
        'secondary-tan': '#E5E5E3',
        'background-color': 'rgb(var(--brepia-canvas) / <alpha-value>)',
        'adam-neutral-100': 'rgb(var(--brepia-neutral-100) / <alpha-value>)',
        'adam-neutral-200': 'rgb(var(--brepia-neutral-200) / <alpha-value>)',
        'adam-neutral-700': 'rgb(var(--brepia-neutral-700) / <alpha-value>)',
        'adam-neutral-900': 'rgb(var(--brepia-neutral-900) / <alpha-value>)',
        'white-16%': 'rgba(255,255,255,0.16)',
        'white-700': 'rgb(var(--brepia-neutral-100) / <alpha-value>)',
        'white-500': 'rgb(var(--brepia-neutral-300) / <alpha-value>)',
        'adam-background-1': 'rgb(var(--brepia-surface-1) / <alpha-value>)',
        'adam-background-2': 'rgb(var(--brepia-surface-2) / <alpha-value>)',
        'adam-neutral-950': 'rgb(var(--brepia-neutral-950) / <alpha-value>)',
        'adam-neutral-900': 'rgb(var(--brepia-neutral-900) / <alpha-value>)',
        'adam-neutral-800': 'rgb(var(--brepia-neutral-800) / <alpha-value>)',
        'adam-neutral-700': 'rgb(var(--brepia-neutral-700) / <alpha-value>)',
        'adam-neutral-500': 'rgb(var(--brepia-neutral-500) / <alpha-value>)',
        'adam-neutral-400': 'rgb(var(--brepia-neutral-400) / <alpha-value>)',
        'adam-neutral-300': 'rgb(var(--brepia-neutral-300) / <alpha-value>)',
        'adam-neutral-200': 'rgb(var(--brepia-neutral-200) / <alpha-value>)',
        'adam-neutral-100': 'rgb(var(--brepia-neutral-100) / <alpha-value>)',
        'adam-neutral-50': 'rgb(var(--brepia-neutral-50) / <alpha-value>)',
        'adam-neutral-10': 'rgb(var(--brepia-neutral-10) / <alpha-value>)',
        'adam-neutral-0': 'rgb(var(--brepia-neutral-0) / <alpha-value>)',
        pink: '#5EBFFF',
        'sidebar-color': 'rgb(var(--brepia-surface-1) / <alpha-value>)',
        'bg-gray': 'rgb(var(--brepia-surface-1) / <alpha-value>)',
        brepia: {
          canvas: 'rgb(var(--brepia-canvas) / <alpha-value>)',
          surface: 'rgb(var(--brepia-surface-1) / <alpha-value>)',
          elevated: 'rgb(var(--brepia-surface-2) / <alpha-value>)',
          text: 'rgb(var(--brepia-text-primary) / <alpha-value>)',
          muted: 'rgb(var(--brepia-text-secondary) / <alpha-value>)',
          subtle: 'rgb(var(--brepia-text-tertiary) / <alpha-value>)',
          border: 'rgb(var(--brepia-border) / <alpha-value>)',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
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
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        'dot-bounce-1': {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-8px)' },
        },
        'dot-bounce-2': {
          '0%, 20%, 100%': { transform: 'translateY(0)' },
          '60%': { transform: 'translateY(-8px)' },
        },
        'dot-bounce-3': {
          '0%, 40%, 100%': { transform: 'translateY(0)' },
          '80%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'dot-bounce-1': 'dot-bounce-1 1.0s infinite ease-in-out',
        'dot-bounce-2': 'dot-bounce-2 1.0s infinite ease-in-out',
        'dot-bounce-3': 'dot-bounce-3 1.0s infinite ease-in-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
