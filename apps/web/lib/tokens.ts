/**
 * Brand color literals for the two surfaces that CANNOT read the CSS `@theme` tokens in
 * `app/globals.css`: the dynamic OG card (Satori / next/og renders inline styles, with no access to CSS
 * variables) and the document `themeColor` metadata. These mirror `app/globals.css` `:root` /
 * `[data-theme="dark"]` and MUST be kept in sync with it by hand. This module is the single place that
 * mirror lives, so the OG image and the theme-color meta read from one source instead of each
 * hand-copying hex. Everything inside the app uses the Tailwind tokens (`bg-canvas`, `text-ink`, ...).
 */
export const BRAND = {
  light: {
    canvas: "#fbfaf7",
    ink: "#1a1a18",
    muted: "#6b6b63",
    accent: "#2b4bf2",
  },
  dark: {
    canvas: "#0e0e0d",
  },
} as const;
