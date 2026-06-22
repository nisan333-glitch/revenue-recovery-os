/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0e1a",
          800: "#0f1626",
          700: "#161f33",
          600: "#1f2a44",
          500: "#2c3a5c",
        },
        proof: {
          500: "#10b981",
          600: "#059669",
        },
        detect: {
          500: "#f59e0b",
          600: "#d97706",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
