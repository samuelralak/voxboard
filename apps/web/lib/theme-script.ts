/**
 * Inline script injected in <head> before paint to set the theme on <html> with no flash of the
 * wrong theme. Reads the saved choice, falling back to the OS preference. Kept dependency-free and
 * tiny; the ThemeProvider takes over once React hydrates.
 */

export const THEME_STORAGE_KEY = "voxboard-theme";

export const themeScript = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k);var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=s==="dark"||s==="light"?s:(m?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;
