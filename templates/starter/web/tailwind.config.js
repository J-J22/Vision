// Theme colors and fonts come from CSS variables in src/theme.css, so the theme task restyles every component.
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));

export default {
  content: [here + "index.html", here + "src/**/*.{js,jsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        "brand-fg": "rgb(var(--brand-fg) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
      },
      fontFamily: { sans: "var(--font)", head: "var(--font-head)" },
      borderRadius: { theme: "var(--radius)" },
    },
  },
};
