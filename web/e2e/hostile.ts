/**
 * For every allowed diagram type, a diagram with `X` in its labels. `X` is replaced by markup that would
 * navigate, load something or run something if it reached the page as HTML. test/mermaid-types.test.ts fails
 * when an allowed type has no entry here.
 */
const TARGET = "https://blocked.invalid/ZZhostile";

export const PAYLOADS: Record<string, string> = {
  "meta refresh": `<meta http-equiv=refresh content='0;url=${TARGET}-meta'>`,
  "base href": `<base href='${TARGET}-base/'>`,
  "link prefetch": `<link rel=prefetch href='${TARGET}-prefetch'>`,
  "img with an event": `<img src='${TARGET}-img' onerror='window.pwned=1' onload='window.pwned=1'>`,
  "svg with an event": `<svg onload='window.pwned=1'><image href='${TARGET}-svg' onerror='window.pwned=1'/></svg>`,
};

export const TEMPLATES: Record<string, string> = {
  "flowchart-v2": 'flowchart LR\n  A["X"] -->|"X"| B{"X"}\n  subgraph S ["X"]\n    B --> C@{ shape: cyl, label: "X" }\n  end',
  "flowchart-elk": 'flowchart-elk LR\n  A["X"] -->|"X"| B',
  swimlane: 'swimlane-beta LR\n  subgraph one ["X"]\n    a["X"] -->|"X"| b["X"]\n  end',
  agentflow: 'agentflow-beta TB\n  flow reviewer["X"]\n    a["X"]@{ shape: input }\n    b["X"]@{ shape: tool }\n    a --> b\n  end',
  sequence: "sequenceDiagram\n  participant A as X\n  A->>B: X\n  Note over B: X\n  loop X\n    B-->>A: X\n  end",
  classDiagram: 'classDiagram\n  class Dog["X"] {\n    +X\n    +bark(X) void\n  }\n  Dog <|-- Cat : X\n  note for Dog "X"',
  stateDiagram: 'stateDiagram-v2\n  state "X" as s1\n  [*] --> s1\n  s1 --> s2: X\n  note right of s2 : X',
  er: 'erDiagram\n  a["X"] {\n    int id PK "X"\n  }\n  a ||--o{ b : "X"',
  gantt: "gantt\n  title X\n  dateFormat YYYY-MM-DD\n  section X\n  X :a1, 2026-01-01, 30d",
  pie: 'pie showData\n  title X\n  "X" : 3',
  journey: "journey\n  title X\n  section X\n    X: 5: X",
  gitGraph: 'gitGraph\n  commit id: "X" tag: "X"\n  branch "X"\n  commit',
  mindmap: 'mindmap\n  root(("X"))\n    ["X"]\n      ("X")',
  timeline: "timeline\n  title X\n  section X\n    X : X",
  quadrantChart: 'quadrantChart\n  title X\n  x-axis "X" --> "X"\n  y-axis "X" --> "X"\n  quadrant-1 "X"\n  "X": [0.3, 0.6]',
  requirement: 'requirementDiagram\n  requirement "X" {\n    id: 1\n    text: "X"\n    risk: high\n    verifymethod: test\n  }\n  element e {\n    type: "X"\n    docref: "X"\n  }',
  c4: 'C4Context\n  title X\n  Person(a, "X", "X")\n  System(b, "X", "X")\n  Rel(a, b, "X", "X")',
  sankey: 'sankey-beta\n\n"X",End,10',
  xychart: 'xychart-beta\n  title "X"\n  x-axis "X" ["X", b]\n  y-axis "X" 0 --> 10\n  bar [3, 7]',
  block: 'block-beta\n  columns 2\n  a["X"] b["X"]\n  a -- "X" --> b',
  packet: 'packet-beta\n  title X\n  0-31: "X"',
  kanban: 'kanban\n  todo["X"]\n    t1["X"]@{ assigned: "X", ticket: "X" }',
  radar: 'radar-beta\n  title X\n  axis m["X"], s["b"], e["c"]\n  curve a["X"]{85, 90, 80}\n  max 100',
  treemap: 'treemap-beta\n"X"\n    "X": 10',
  treeView: 'treeView-beta\n├── "X"\n│   └── "X"\n└── README.md',
  ishikawa: "ishikawa-beta\n    X\n    X\n        X",
  railroad: 'railroad-beta\ntitle "X"\ndigit = choice(terminal("X"), terminal("1")) ;',
  railroadEbnf: 'railroad-ebnf-beta\ntitle "X"\ndigit = "X" | "1" ;',
  railroadAbnf: 'railroad-abnf-beta\ntitle "X"\ndigit = "X" / "1" ;',
  railroadPeg: 'railroad-peg-beta\ntitle "X"\ndigit <- "X" / "1" ;',
  wardley: 'wardley-beta\ntitle X\nanchor "X" [0.95, 0.63]\ncomponent "X b" [0.63, 0.81]\n"X" -> "X b"',
  cynefin: 'cynefin-beta\n  title X\n  complex\n    "X"\n  clear\n    "X"',
  usecase: 'usecase-beta\ndirection LR\nactor Customer("X")\nsystemBoundary "X"\n  Checkout("X")\nend\nCustomer --> Checkout',
  info: "info",
};
