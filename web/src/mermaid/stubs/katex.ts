/** Takes the place of KaTeX in the build of the Mermaid page: a formula stays as the text typed. */
const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export default {
  renderToString: (formula: string): string => `<span>$$${formula.replace(/[&<>"]/g, (c) => escapes[c]!)}$$</span>`,
};
