/**
 * The diagram types that the app draws, by the id Mermaid detects. Only types that put no text of the diagram
 * into the page as HTML while they are drawn: e2e/mermaid-hostile.spec.ts checks each one. A type that is not
 * listed here is refused, so a new version of Mermaid cannot add one unnoticed (test/mermaid-types.test.ts).
 */
export const ALLOWED_TYPES: readonly string[] = [
  "agentflow",
  "block",
  "c4",
  "classDiagram",
  "cynefin",
  "er",
  "flowchart-elk",
  "flowchart-v2",
  "gantt",
  "gitGraph",
  "info",
  "ishikawa",
  "journey",
  "kanban",
  "mindmap",
  "packet",
  "pie",
  "quadrantChart",
  "radar",
  "railroad",
  "railroadAbnf",
  "railroadEbnf",
  "railroadPeg",
  "requirement",
  "sankey",
  "sequence",
  "stateDiagram",
  "swimlane",
  "timeline",
  "treeView",
  "treemap",
  "usecase",
  "wardley",
  "xychart",
];

/** The types that Mermaid draws by putting their text into the page as HTML. */
export const REFUSED_TYPES: readonly string[] = ["architecture", "eventmodeling", "venn"];
