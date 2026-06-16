/**
 * Defensive text/URL sanitization for untrusted relay content. Strips characters that scramble or spoof
 * display without changing meaning: Unicode bidi overrides/embeddings/isolates (used to visually reorder
 * a title/name), zero-width / invisible formatting characters used to fake emptiness or pad past a
 * length check, and C0/C1 control characters (other than the whitespace a multi-line body uses).
 *
 * Deliberately PRESERVED: U+200C ZWNJ and U+200D ZWJ. ZWJ holds multi-codepoint emoji sequences
 * together (👨‍👩‍👧‍👦, 🏳️‍🌈) and both are orthographically significant in Persian/Arabic-script and
 * Indic scripts, so stripping them would silently corrupt legitimate content.
 *
 * Built with RegExp() from ASCII escape strings on purpose, so no raw invisible/control bytes ever live
 * in this source file.
 */

// ZWSP (U+200B), LRM/RLM (U+200E/U+200F), bidi embeddings/overrides (U+202A-U+202E), invisible
// separators / word joiner (U+2060-U+2064), bidi isolates (U+2066-U+2069), BOM/ZWNBSP (U+FEFF),
// soft hyphen (U+00AD). NOT U+200C/U+200D (see above).
const INVISIBLE = new RegExp(
  "[\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\u00AD]",
  "g",
);
// C0 controls except tab/newline/carriage-return, plus DEL and the C1 control range.
const CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g");
// Blank-but-not-whitespace glyphs (Hangul fillers, Braille blank, Mongolian vowel separator, halfwidth
// Hangul filler): they render as nothing yet are not stripped by \s, so they can fake a non-empty name.
const BLANK_GLYPH = new RegExp("[\\u115F\\u1160\\u3164\\u2800\\u180E\\uFFA0]", "g");
// A run of combining marks (Zalgo) collapsed to at most two, so a title/name can't be scrambled or
// stretched past its line by stacking diacritics on a base character.
const COMBINING_RUN = /(\p{M}{1,2})\p{M}*/gu;

/**
 * Strip invisible/bidi/control characters from free text, preserving normal whitespace (tabs, newlines)
 * and meaningful joiners. NFC-normalized first so equivalent sequences compare/measure consistently.
 */
export function sanitizeText(value: string): string {
  return value.normalize("NFC").replace(INVISIBLE, "").replace(CONTROL, "");
}

/**
 * Like sanitizeText, but for single-line display fields (names, titles, categories): also removes
 * blank-glyph padding, caps combining-mark runs (anti-Zalgo), collapses whitespace, and trims. A field
 * that is only invisible/blank junk collapses to "" so the empty-field guards reject it.
 */
export function sanitizeLine(value: string): string {
  return sanitizeText(value).replace(BLANK_GLYPH, "").replace(COMBINING_RUN, "$1").replace(/\s+/g, " ").trim();
}

/** True only for http(s) URLs; rejects javascript:, data:, file:, etc. before using a URL in src/href. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
