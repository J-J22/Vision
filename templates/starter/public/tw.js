// Tailwind (loaded from its CDN in each page's <head>) uses the theme's colors and fonts. Agents don't edit this file.
tailwind.config = {
  corePlugins: { preflight: false }, // keep style.css's base styles
  theme: {
    extend: {
      colors: { brand: "var(--brand)", accent: "var(--accent)", bg: "var(--bg)", card: "var(--card)", fg: "var(--fg)", muted: "var(--muted)", line: "var(--line)" },
      fontFamily: { sans: "var(--font)", head: "var(--font-head)" },
      borderRadius: { theme: "var(--radius)" },
    },
  },
};
