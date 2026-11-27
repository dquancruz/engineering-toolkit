/**
 * Cleans Mermaid's SVG before it is shown or downloaded. Mermaid's strict mode keeps links to web pages, and a
 * downloaded file is opened without this site's Content-Security-Policy. Only drawing elements are kept: no
 * links, scripts, embedded HTML, animations or references outside the file.
 */
import type { DiagramNotice } from "../core/diagram/source.js";
import { cleanCss } from "../core/diagram/css.js";

const ELEMENTS = new Set(
  "svg g path rect circle ellipse line polyline polygon text tspan textPath defs marker style title desc linearGradient radialGradient stop clipPath mask pattern filter feDropShadow feGaussianBlur feOffset feMerge feMergeNode feFlood feComposite feColorMatrix feBlend feMorphology symbol use image switch".split(
    " "
  )
);

export interface Clean {
  /** A standalone SVG file, with its size in `width` and `height`. */
  svg: string;
  width: number;
  height: number;
  /** The diagram's own accessible title and description (accTitle, accDescr). */
  title: string;
  description: string;
  texts: string[];
  notices: DiagramNotice[];
}

export function sanitize(markup: string): Clean {
  // an inert document: nothing in it loads or runs
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const root = parsed.body.querySelector("svg");
  if (!root) throw new Error("Mermaid produced no SVG");
  const notices = new Set<DiagramNotice>();

  const walk = (element: Element) => {
    for (const child of [...element.children]) {
      const name = child.localName;
      walk(child);
      if (name === "a") {
        notices.add("links-removed");
        const group = parsed.createElementNS(root.namespaceURI, "g");
        const style = child.getAttribute("class");
        if (style) group.setAttribute("class", style);
        group.append(...child.childNodes);
        child.replaceWith(group);
      } else if (child.namespaceURI !== root.namespaceURI || !ELEMENTS.has(name)) {
        child.remove();
      }
    }
  };
  walk(root);

  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase();
      const value = attribute.value;
      let keep = true;
      if (name.startsWith("on")) keep = false;
      else if (name === "href" || name === "src") {
        // a picture inside the file, or another element of the file
        keep = element.localName === "image" ? /^data:image\//i.test(value) : value.startsWith("#");
        if (!keep) notices.add("external-removed");
      } else if (name !== "xmlns" && attribute.prefix !== "xmlns") {
        const cleaned = cleanCss(value, name === "style" || /url|\\/i.test(value));
        if (cleaned !== value) {
          notices.add("external-removed");
          element.setAttribute(attribute.name, cleaned);
        }
      }
      if (!keep) element.removeAttributeNode(attribute);
    }
    if (element.localName === "style") {
      const css = element.textContent ?? "";
      const cleaned = cleanCss(css, true);
      if (cleaned !== css) {
        notices.add("external-removed");
        element.textContent = cleaned;
      }
    }
  }

  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const width = Math.max(1, Math.ceil(box[2] || Number.parseFloat(root.getAttribute("width") ?? "") || 300));
  const height = Math.max(1, Math.ceil(box[3] || Number.parseFloat(root.getAttribute("height") ?? "") || 150));
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  (root as SVGElement).style.removeProperty("max-width");

  const own = (name: "title" | "desc") => [...root.children].find((c) => c.localName === name)?.textContent?.trim() ?? "";
  const texts = [...new Set([...root.querySelectorAll("text")].map((t) => (t.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))];
  return { svg: new XMLSerializer().serializeToString(root), width, height, title: own("title"), description: own("desc"), texts, notices: [...notices] };
}
