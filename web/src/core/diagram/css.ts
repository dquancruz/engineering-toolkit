/** Removes from CSS (a style sheet, a style attribute or a presentation attribute) whatever could load a file. */
export function cleanCss(css: string, decode: boolean): string {
  // `\75rl(` is `url(`: decode the escapes before looking
  const text = decode && css.includes("\\") ? css.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([^\n])/g, (_, hex: string | undefined, char: string | undefined) => (hex ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)) : char!)) : css;
  const dangerous = /@import|@font-face|url\s*\(\s*(?!\s*["']?#)|image-set\s*\(|\bimage\s*\(|\bsrc\s*\(/i;
  if (!dangerous.test(text.replace(/\/\*[\s\S]*?\*\//g, ""))) return css;
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*(;|$)/gi, "")
    .replace(/@font-face\s*\{[^}]*\}?/gi, "")
    .replace(/(?:-webkit-)?(?:image-set|\bimage|\bsrc|url)\s*\(\s*(?!\s*["']?#)(?:"[^"]*"|'[^']*'|[^()"']|\([^()]*\))*\)?/gi, "none");
}
