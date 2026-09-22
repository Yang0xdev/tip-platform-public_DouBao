/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#002661", hover: "#1E3E78", 50: "#EDF1F8", 100: "#DCE4F2" },
        berry: { DEFAULT: "#AF2D67", light: "#C63D80", dark: "#A5275F", 50: "#FAEEF4" },
        ink: "#1B2433",
        mut: "#5E6B7E",
        faint: "#8A95A6",
        line: { DEFAULT: "#E5E9F0", soft: "#F0F3F8" },
        paper: "#F5F7FA",
        ok: { DEFAULT: "#177A5B", bg: "#E6F4EE" },
        warn: { DEFAULT: "#B45309", bg: "#FBF1E2" },
        bad: { DEFAULT: "#C03221", bg: "#FCEBEA" },
        info: { DEFAULT: "#1D5F8A", bg: "#E9F2F8" },
        purple: { DEFAULT: "#6B5AA8", bg: "#EFECF7" }
      },
      borderRadius: { card: "15px", btn: "22px" },
      boxShadow: {
        sh1: "0 1px 2px rgba(16,32,67,.05), 0 6px 18px -8px rgba(16,32,67,.12)",
        sh2: "0 2px 6px rgba(16,32,67,.05), 0 20px 44px -14px rgba(15,35,80,.22)"
      },
      fontFamily: {
        sans: ["Manrope", "Noto Sans SC", "system-ui", "-apple-system", "PingFang SC", "Microsoft YaHei", "sans-serif"]
      }
    }
  },
  plugins: []
};
