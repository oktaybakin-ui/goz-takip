import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/contexts/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/styles/**/*.css",
  ],
  safelist: [
    // Dinamik olarak oluşturulan class'lar
    'bg-green-400',
    'bg-red-400',
    'bg-yellow-400',
    'animate-pulse',
    'animate-spin',
    // Dinamik width/height
    { pattern: /^(w|h)-\d+$/ },
    // Dinamik renkler
    { pattern: /^(bg|text|border)-(gray|blue|green|red|yellow)-(400|500|600|700)$/ },
  ],
  theme: {
    extend: {
      // Custom animations
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      // Custom colors
      colors: {
        'gaze': {
          50: '#e6f3ff',
          100: '#b3daff',
          200: '#80c1ff',
          300: '#4da8ff',
          400: '#1a8fff',
          500: '#0076e6',
          600: '#005db3',
          700: '#004480',
          800: '#002b4d',
          900: '#00121a',
        },
      },
    },
  },
  plugins: [],
  // Production optimizasyonları
  future: {
    hoverOnlyWhenSupported: true,
  },
};

export default config;
