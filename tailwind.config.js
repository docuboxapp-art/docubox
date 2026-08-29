/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Google Sans', 'Google Sans Text', 'Segoe UI', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          50: '#eff5ff',
          100: '#d9e8ff',
          200: '#b8d3ff',
          500: '#347cff',
          600: '#1e6bff',
          700: '#1557d6',
          800: '#1749ad',
          900: '#193f88',
        },
        blue: {
          50: '#eff5ff',
          100: '#d9e8ff',
          200: '#b8d3ff',
          300: '#86b5ff',
          400: '#5494ff',
          500: '#347cff',
          600: '#1e6bff',
          700: '#1557d6',
          800: '#1749ad',
          900: '#193f88',
          950: '#102754',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
          50: 'hsl(210, 40%, 98%)',
          100: 'hsl(210, 40%, 96.1%)',
          200: 'hsl(214.3, 31.8%, 91.4%)',
          800: 'hsl(217.2, 32.6%, 17.5%)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        'card-hover': '0 4px 12px 0 rgba(0, 0, 0, 0.12), 0 2px 4px -1px rgba(0, 0, 0, 0.08)',
        modal: '0 20px 60px -10px rgba(0, 0, 0, 0.25)',
        dropdown: '0 8px 24px -4px rgba(0, 0, 0, 0.15)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'pulse-highlight': 'pulseHighlight 0.6s ease-out',
      },
    },
  },
  plugins: [],
};
