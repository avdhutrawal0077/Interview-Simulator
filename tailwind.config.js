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
        sidebar: "#121317",
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
      fontSize: {
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-lg-mobile": ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "title-md": ["20px", { lineHeight: "28px", letterSpacing: "0em", fontWeight: "600" }],
        "body-lg": ["17px", { lineHeight: "24px", letterSpacing: "-0.01em", fontWeight: "400" }],
        "body-md": ["15px", { lineHeight: "20px", letterSpacing: "0em", fontWeight: "400" }],
        "label-sm": ["13px", { lineHeight: "18px", letterSpacing: "0.02em", fontWeight: "500" }],
      },
      borderRadius: {
        card: "24px",
        button: "12px",
        bubble: "14px",
        chip: "8px",
      },
      animation: {
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
}
