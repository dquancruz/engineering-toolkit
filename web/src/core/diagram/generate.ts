/**
 * Mermaid code from a table. Names are never used as identifiers: nodes, entities and participants get generated
 * ids and the text goes where Mermaid reads it as text. How a character can be written depends on the diagram,
 * because Mermaid draws SVG text (see e2e/mermaid.spec.ts, which draws every rule):
 * - sequence diagrams decode entity codes, such as `#35;`;
 * - flowcharts and entity-relationship diagrams do not: an invisible zero-width space (U+200B) after a character
 *   stops it from being read as markup, an entity, a directive or a formula;
 * - what cannot be written either way becomes a look-alike character, and is reported.
 */
import { TableError, columns, readTable, type TableDelimiter } from "./table.js";

export const KINDS = ["flowchart", "er", "gantt", "sequence"] as const;
export type Kind = (typeof KINDS)[number];

export const DIRECTIONS = ["LR", "TD", "RL", "BT"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface Replacement {
  line: number;
  from: string;
  to: string;
}

export interface Generated {
  code: string;
  /** Texts that could not be written as they were. */
  replaced: Replacement[];
  /** The content in words, for the diagram's text alternative: one entry per relation, attribute or task. */
  outline: string[];
}

export interface TableInput {
  kind: Kind;
  text: string;
  /** Second table of an entity-relationship diagram. */
  relations?: string;
  delimiter?: TableDelimiter;
  direction?: Direction;
}

/** Control characters and line breaks inside a cell become one space. */
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();

/** An invisible character after each of `characters` breaks the sequence Mermaid would read as syntax. */
const separate = (text: string, characters: RegExp) => text.replace(characters, "$&\u200B");

const sequenceText = (text: string) => oneLine(text).replace(/["#<>&%;:\\$]/g, (c) => (c === '"' ? "#quot;" : c === "<" ? "#lt;" : c === ">" ? "#gt;" : `#${c.codePointAt(0)};`));

const LOOKALIKES: Record<string, string> = { '"': "\uFF02", "#": "\uFF03", ";": "\uFF1B", ":": "\uA789", "%": "\uFF05", "<": "\uFF1C", ">": "\uFF1E", "*": "\u2217", "`": "\uFF40", "~": "\u223C", "\\": "\uFF3C" };

class Writer {
  readonly replaced: Replacement[] = [];
  swap(line: number, text: string, characters: RegExp): string {
    const plain = oneLine(text);
    return this.note(line, plain, plain.replace(characters, (found) => LOOKALIKES[found] ?? (found.startsWith("_") ? "\uFF3F".repeat(found.length) : "_")));
  }
  note(line: number, from: string, to: string): string {
    if (from !== to && !this.replaced.some((r) => r.line === line && r.from === from)) this.replaced.push({ line, from, to });
    return to;
  }
}

/** A text of a flowchart. A backtick at the start would make it Markdown. */
function flowText(writer: Writer, line: number, text: string): string {
  const safe = separate(writer.swap(line, text, /[">]/g), /[<&#%*_~\\`$:]/g);
  return safe.startsWith("`") ? `\u200B${safe}` : safe;
}

/**
 * A name, comment or label of an entity-relationship diagram. Its grammar refuses `"`, `%` and `\`; `*`,
 * backticks and an underscore at the edge of a word are Markdown, and `~x~` becomes `<x>`.
 */
const erText = (writer: Writer, line: number, text: string) =>
  separate(writer.swap(line, text, /["%\\`*~]|(?<![\p{L}\p{N}_])_+|_+(?![\p{L}\p{N}_])/gu), /[<&#\]$]/g);

/** Gives every distinct name a generated id, in order of appearance. */
function ids(prefix: string) {
  const known = new Map<string, { id: string; line: number }>();
  return {
    of(name: string, line: number): string {
      let entry = known.get(name);
      if (!entry) known.set(name, (entry = { id: `${prefix}${known.size + 1}`, line }));
      return entry.id;
    },
    entries: () => [...known].map(([name, entry]) => ({ name, ...entry })),
  };
}

function flowchart(input: TableInput): Generated {
  const rows = columns(readTable(input.text, input.delimiter), {
    from: { names: ["origen", "source", "from", "de"], required: true },
    to: { names: ["destino", "target", "to", "a"], required: true },
    label: { names: ["etiqueta", "label"] },
  });
  const nodes = ids("n");
  const writer = new Writer();
  const outline: string[] = [];
  const edges = rows.map((row) => {
    const from = nodes.of(row.get("from"), row.line);
    const to = nodes.of(row.get("to"), row.line);
    const label = row.get("label");
    outline.push(`${oneLine(row.get("from"))} → ${oneLine(row.get("to"))}${label ? ` (${oneLine(label)})` : ""}`);
    return `  ${from} -->${label ? `|"${flowText(writer, row.line, label)}"|` : ""} ${to}`;
  });
  const declarations = nodes.entries().map((n) => `  ${n.id}["${flowText(writer, n.line, n.name)}"]`);
  return { code: [`flowchart ${input.direction ?? "LR"}`, ...declarations, ...edges].join("\n"), replaced: writer.replaced, outline };
}

function sequence(input: TableInput): Generated {
  const rows = columns(readTable(input.text, input.delimiter), {
    from: { names: ["de", "from", "origen", "source"], required: true },
    to: { names: ["para", "to", "destino", "target"], required: true },
    message: { names: ["mensaje", "message"], required: true },
    type: { names: ["tipo", "type"] },
  });
  const arrows: Record<string, string> = { "": "->>", llamada: "->>", call: "->>", async: "-)", asincrono: "-)", "asíncrono": "-)", respuesta: "-->>", reply: "-->>" };
  const people = ids("p");
  const outline: string[] = [];
  const messages = rows.map((row) => {
    const type = row.get("type").toLowerCase();
    if (!Object.hasOwn(arrows, type)) throw new TableError("message-type", { line: row.line, value: row.get("type") });
    const from = people.of(row.get("from"), row.line);
    const to = people.of(row.get("to"), row.line);
    outline.push(`${oneLine(row.get("from"))} → ${oneLine(row.get("to"))}: ${oneLine(row.get("message"))}`);
    return `  ${from}${arrows[type]}${to}: ${sequenceText(row.get("message"))}`;
  });
  const declarations = people.entries().map((p) => `  participant ${p.id} as ${sequenceText(p.name)}`);
  return { code: ["sequenceDiagram", ...declarations, ...messages].join("\n"), replaced: [], outline };
}

function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

const STATUSES: Record<string, string> = { done: "done", hecha: "done", hecho: "done", active: "active", activa: "active", activo: "active", crit: "crit", critica: "crit", "crítica": "crit", milestone: "milestone", hito: "milestone" };
/** A task or section that starts like a statement of the gantt grammar would be read as one. */
const GANTT_KEYWORD = /^(gantt|section|title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|inclusiveEndDates|topAxis|weekday|weekend|click|call|href|accTitle|accDescr)\b/i;

function gantt(input: TableInput): Generated {
  const rows = columns(readTable(input.text, input.delimiter), {
    section: { names: ["seccion", "section"] },
    task: { names: ["tarea", "task"], required: true },
    id: { names: ["id", "id"] },
    start: { names: ["inicio", "start"] },
    end: { names: ["fin", "end"] },
    duration: { names: ["duracion", "duration"] },
    after: { names: ["despues", "after"] },
    status: { names: ["estado", "status"] },
  });
  const writer = new Writer();
  const text = (line: number, value: string) => {
    const swapped = writer.swap(line, value, /[:#;%<>\\]/g);
    // a zero-width space stops the grammar from reading the name as a keyword
    return GANTT_KEYWORD.test(swapped) ? `\u200B${swapped}` : swapped;
  };

  const own = new Set<string>();
  for (const row of rows) {
    const id = row.get("id");
    if (id === "") continue;
    if (!/^[A-Za-z][\w-]*$/.test(id)) throw new TableError("id", { line: row.line, value: id });
    if (own.has(id)) throw new TableError("repeated-id", { line: row.line, value: id });
    own.add(id);
  }
  const outline: string[] = [];
  const sections = new Map<string, string[]>();
  let automatic = 0;
  for (const row of rows) {
    const words = row.get("status").toLowerCase().split(/[\s,]+/).filter(Boolean);
    const tags = words.map((word) => {
      if (!Object.hasOwn(STATUSES, word)) throw new TableError("status", { line: row.line, value: word });
      return STATUSES[word]!;
    });
    let id = row.get("id");
    while (id === "" || (row.get("id") === "" && own.has(id))) id = `t${++automatic}`;

    const after = row.get("after").split(/[\s,]+/).filter(Boolean);
    for (const other of after) if (!own.has(other)) throw new TableError("unknown-id", { line: row.line, value: other });
    const start = row.get("start");
    if (start !== "" && !isDate(start)) throw new TableError("date", { line: row.line, value: start });
    if ((start === "") === (after.length === 0)) throw new TableError("start", { line: row.line });

    const end = row.get("end");
    const duration = row.get("duration");
    if (end !== "" && !isDate(end)) throw new TableError("date", { line: row.line, value: end });
    if (duration !== "" && !/^\d+(\.\d+)?[hdw]$/.test(duration)) throw new TableError("duration", { line: row.line, value: duration });
    const milestone = tags.includes("milestone");
    if (end !== "" && duration !== "") throw new TableError("end", { line: row.line });
    if (end === "" && duration === "" && !milestone) throw new TableError("end", { line: row.line });
    if (start !== "" && end !== "" && end < start) throw new TableError("date", { line: row.line, value: end });

    const from = start !== "" ? start : `after ${after.join(" ")}`;
    const length = end || duration || "0d";
    const section = row.get("section");
    const task = text(row.line, row.get("task"));
    const lines = sections.get(section) ?? [];
    sections.set(section, lines);
    lines.push(`  ${task} :${[...tags, id, from, length].join(", ")}`);
    outline.push(`${section ? `${oneLine(section)}: ` : ""}${oneLine(row.get("task"))} (${from}, ${length})`);
  }
  // tasks without a section go first: after a `section` line they would belong to it
  const body = [...sections]
    .sort(([a], [b]) => Number(a !== "") - Number(b !== ""))
    .flatMap(([name, lines]) => (name === "" ? lines : [`  section ${text(rows.find((r) => r.get("section") === name)!.line, name)}`, ...lines]));
  return { code: ["gantt", "  dateFormat YYYY-MM-DD", ...body].join("\n"), replaced: writer.replaced, outline };
}

const CARDINALITY: Record<string, { left: string; right: string }> = {
  "1": { left: "||", right: "||" },
  "0..1": { left: "|o", right: "o|" },
  "0..n": { left: "}o", right: "o{" },
  "1..n": { left: "}|", right: "|{" },
};

/** Attribute names and types must be identifiers: anything else becomes `_`. */
function identifier(writer: Writer, line: number, value: string): string {
  const plain = oneLine(value);
  let safe = plain.replace(/[^A-Za-z0-9_\-[\]()*\u00C0-\u024F]/g, "_");
  if (!/^[A-Za-z_*\u00C0-\u024F]/.test(safe)) safe = `_${safe}`;
  return writer.note(line, plain, safe);
}

function er(input: TableInput): Generated {
  const writer = new Writer();
  const entities_ = ids("e");
  const attributes = new Map<string, string[]>();
  const outline: string[] = [];
  const rows = columns(readTable(input.text, input.delimiter), {
    entity: { names: ["entidad", "entity"], required: true },
    attribute: { names: ["atributo", "attribute"], required: true },
    type: { names: ["tipo", "type"], required: true },
    key: { names: ["clave", "key"] },
    comment: { names: ["comentario", "comment"] },
  });
  for (const row of rows) {
    const id = entities_.of(row.get("entity"), row.line);
    const keys = row.get("key").toUpperCase().split(/[\s,]+/).filter(Boolean);
    const bad = keys.find((k) => !["PK", "FK", "UK"].includes(k));
    if (bad !== undefined) throw new TableError("key", { line: row.line, value: bad });
    const comment = row.get("comment");
    const parts = [identifier(writer, row.line, row.get("type")), identifier(writer, row.line, row.get("attribute"))];
    if (keys.length > 0) parts.push(keys.join(", "));
    if (comment !== "") parts.push(`"${erText(writer, row.line, comment)}"`);
    (attributes.get(id) ?? attributes.set(id, []).get(id)!).push(`    ${parts.join(" ")}`);
    outline.push(`${oneLine(row.get("entity"))}.${oneLine(row.get("attribute"))}: ${oneLine(row.get("type"))}${keys.length ? ` (${keys.join(", ")})` : ""}`);
  }

  const relations: string[] = [];
  if (input.relations?.trim()) {
    try {
      const found = columns(readTable(input.relations, input.delimiter), {
        from: { names: ["origen", "source", "from"], required: true },
        fromCardinality: { names: ["cardinalidad_origen", "source_cardinality", "from_cardinality"], required: true },
        to: { names: ["destino", "target", "to"], required: true },
        toCardinality: { names: ["cardinalidad_destino", "target_cardinality", "to_cardinality"], required: true },
        label: { names: ["etiqueta", "label"] },
      });
      for (const row of found) {
        const side = (column: "fromCardinality" | "toCardinality") => {
          const value = row.get(column).toLowerCase().replace(/\s/g, "").replace(/\*/g, "n");
          if (!Object.hasOwn(CARDINALITY, value)) throw new TableError("cardinality", { line: row.line, value: row.get(column) });
          return { value, symbols: CARDINALITY[value]! };
        };
        const left = side("fromCardinality");
        const right = side("toCardinality");
        const label = row.get("label");
        const from = entities_.of(row.get("from"), row.line);
        const to = entities_.of(row.get("to"), row.line);
        relations.push(`  ${from} ${left.symbols.left}--${right.symbols.right} ${to} : "${label ? erText(writer, row.line, label) : ""}"`);
        outline.push(`${oneLine(row.get("from"))} (${left.value}) — ${oneLine(row.get("to"))} (${right.value})${label ? `: ${oneLine(label)}` : ""}`);
      }
    } catch (e) {
      if (e instanceof TableError) e.table = "relations";
      throw e;
    }
  }

  const blocks = entities_.entries().flatMap((e) => {
    const name = `  ${e.id}["${erText(writer, e.line, e.name)}"]`;
    const own = attributes.get(e.id);
    return own ? [`${name} {`, ...own, "  }"] : [name];
  });
  return { code: ["erDiagram", ...blocks, ...relations].join("\n"), replaced: writer.replaced, outline };
}

const GENERATORS: Record<Kind, (input: TableInput) => Generated> = { flowchart, er, gantt, sequence };

export const generate = (input: TableInput): Generated => GENERATORS[input.kind](input);

export const EXAMPLES: Record<"es" | "en", Record<Kind, { text: string; relations?: string }>> = {
  es: {
    flowchart: { text: 'origen,destino,etiqueta\nInicio,Validar,\nValidar,Guardar,"correcto, completo"\nValidar,Inicio,hay errores' },
    er: {
      text: "entidad,atributo,tipo,clave,comentario\nCliente,id,int,PK,\nCliente,correo,string,UK,único\nPedido,id,int,PK,\nPedido,cliente_id,int,FK,",
      relations: "origen,cardinalidad_origen,destino,cardinalidad_destino,etiqueta\nCliente,1,Pedido,0..n,hace",
    },
    gantt: { text: "seccion,tarea,id,inicio,duracion,despues,estado\nDiseño,Boceto,a1,2026-12-01,3d,,done\nDiseño,Revisión,a2,,2d,a1,active\nEntrega,Publicar,a3,,,a2,milestone" },
    sequence: { text: "| de | para | mensaje | tipo |\n|----|------|---------|------|\n| Web | API | POST /pedidos | |\n| API | Web | 201 creado | respuesta |" },
  },
  en: {
    flowchart: { text: 'source,target,label\nStart,Validate,\nValidate,Save,"valid, complete"\nValidate,Start,has errors' },
    er: {
      text: "entity,attribute,type,key,comment\nCustomer,id,int,PK,\nCustomer,email,string,UK,unique\nOrder,id,int,PK,\nOrder,customer_id,int,FK,",
      relations: "source,source_cardinality,target,target_cardinality,label\nCustomer,1,Order,0..n,places",
    },
    gantt: { text: "section,task,id,start,duration,after,status\nDesign,Sketch,a1,2026-12-01,3d,,done\nDesign,Review,a2,,2d,a1,active\nDelivery,Publish,a3,,,a2,milestone" },
    sequence: { text: "| from | to | message | type |\n|------|----|---------|------|\n| Web | API | POST /orders | |\n| API | Web | 201 created | reply |" },
  },
};
