/** `release/*` style patterns; `*` matches any characters, including `/`. Same matching as the guard script. */
export function matchesBranch(branch: string, patterns: string[], options: { ignoreCase?: boolean } = {}): boolean {
  return patterns.some((p) => {
    const source = "^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
    return new RegExp(source, options.ignoreCase ? "i" : "").test(branch);
  });
}
