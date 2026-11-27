import type { MermaidConfig } from "mermaid";

/**
 * The configuration of every drawing. `secure` lists the keys that a diagram cannot change from its front
 * matter or `%%{init}%%`, at any depth: Mermaid's own list does not protect most of these.
 */
export const CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  // plain SVG text: HTML inside the SVG would be lost in the picture
  htmlLabels: false,
  journey: { textPlacement: "tspan" },
  // with plain text, Mermaid writes these journey labels white on a pale box
  themeCSS: "text.journey-section, text.task { fill: #333333; }",
  // ELK is not part of this build, and it is Mermaid's default
  layout: "dagre",
  // fonts of the system: nothing is downloaded
  fontFamily: "system-ui, sans-serif",
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "suppressErrorRendering",
    "maxEdges",
    "htmlLabels",
    "textPlacement",
    "layout",
    "themeCSS",
    "themeVariables",
    "fontFamily",
    "altFontFamily",
    "dompurifyConfig",
  ],
};
