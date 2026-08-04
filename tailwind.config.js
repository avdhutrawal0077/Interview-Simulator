/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0A0A0A",
        surface: "#1C1C1E",
        "surface-border": "#2C2C2E",
        "surface-border-subtle": "#3A3A3C",
        "text-primary": "#F5F5F7",
        "text-secondary": "#8E8E93",
        "accent-green": "#30D158",
        "user-bubble": "#2C2C2E",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      borderRadius: {
        card: "24px",
        button: "12px",
        bubble: "14px",
      },
      animation: {
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
}
