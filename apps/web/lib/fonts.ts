/**
 * Typography (see docs/DESIGN.md): an opinionated pairing, not default Inter.
 * - Display: Fraunces, a characterful literary serif for the editorial paper feel.
 * - Sans: Hanken Grotesk, a tall-x-height grotesk for dense UI and body.
 * - Mono: JetBrains Mono for code, npubs, and relay URLs.
 * Each exposes a CSS variable consumed by the Tailwind v4 @theme in globals.css.
 */

import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

export const fontDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  // Load the optical-size axis so large display headings can use the high-contrast cut (see globals.css).
  axes: ["opsz"],
});

export const fontSans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = `${fontSans.variable} ${fontDisplay.variable} ${fontMono.variable}`;
