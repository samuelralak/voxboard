/**
 * Adversarial: untrusted relay text. Bidi-override / zero-width / control characters in titles, names,
 * and bodies must be neutralized so a malicious event cannot scramble the meta line or fake emptiness,
 * and only http(s) image URLs are honored. Special characters are built via fromCharCode so no raw
 * invisible/control bytes live in this test source.
 */

import { describe, expect, it } from "vitest";
import { isHttpUrl, sanitizeLine, sanitizeText } from "../src/index";

const RLO = String.fromCharCode(0x202e); // right-to-left override
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const BOM = String.fromCharCode(0xfeff);
const BEL = String.fromCharCode(0x07);

describe("sanitizeLine / sanitizeText", () => {
  it("strips bidi overrides and zero-width characters", () => {
    expect(sanitizeLine(`hi${RLO}there${ZWSP}`)).toBe("hithere");
    expect(sanitizeText(`a${BOM}b`)).toBe("ab");
  });

  it("a string of only invisible characters collapses to empty", () => {
    expect(sanitizeLine(`${ZWSP}${RLO}${BOM}`)).toBe("");
  });

  it("collapses whitespace on a line but preserves newlines in text", () => {
    expect(sanitizeLine("a   b\tc")).toBe("a b c");
    expect(sanitizeText("line1\nline2")).toBe("line1\nline2");
  });

  it("strips C0/C1 control characters but keeps tabs and newlines", () => {
    expect(sanitizeText(`a${BEL}b`)).toBe("ab");
    expect(sanitizeText("a\tb\nc")).toBe("a\tb\nc");
  });

  it("PRESERVES ZWJ emoji sequences and ZWNJ scripts (must not split them)", () => {
    const ZWJ = String.fromCharCode(0x200d);
    const ZWNJ = String.fromCharCode(0x200c);
    const VS16 = String.fromCharCode(0xfe0f);
    const cp = (n: number) => String.fromCodePoint(n);
    const family = cp(0x1f468) + ZWJ + cp(0x1f469) + ZWJ + cp(0x1f467) + ZWJ + cp(0x1f466); // 👨‍👩‍👧‍👦
    const rainbow = cp(0x1f3f3) + VS16 + ZWJ + cp(0x1f308); // 🏳️‍🌈
    const persian = `mi${ZWNJ}khwham`; // ZWNJ between letters
    expect(sanitizeText(family)).toBe(family); // ZWJ kept -> still one grapheme
    expect(sanitizeText(rainbow)).toBe(rainbow);
    expect(sanitizeLine(persian)).toContain(ZWNJ); // ZWNJ kept
  });

  it("strips blank-but-not-whitespace glyphs from single-line fields (fake-empty defense)", () => {
    const braille = String.fromCharCode(0x2800);
    const hangulFiller = String.fromCharCode(0x3164);
    expect(sanitizeLine(`${braille}${braille}${hangulFiller}`)).toBe("");
    // body (sanitizeText) keeps them: an all-blank body is not a security issue and braille is content
    expect(sanitizeText(braille)).toBe(braille);
  });

  it("caps Zalgo combining-mark runs on a single-line field", () => {
    const zalgo = "z" + String.fromCharCode(0x0301).repeat(40); // 'z' + 40 acute accents (z+acute has no NFC form)
    const out = sanitizeLine(zalgo);
    const marks = [...out].filter((ch) => /\p{M}/u.test(ch)).length;
    expect(marks).toBeLessThanOrEqual(2);
    expect(out.normalize("NFD").startsWith("z")).toBe(true); // base letter preserved
    expect(out.length).toBeLessThanOrEqual(3);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https only", () => {
    expect(isHttpUrl("https://example.com/x.png")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });
  it("rejects javascript:, data:, file:, and garbage", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});
