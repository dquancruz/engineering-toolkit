import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { ALLOWED_TYPES, REFUSED_TYPES } from "../src/core/diagram/types.js";
import { TEMPLATES } from "../e2e/hostile.js";
import { SAMPLES } from "../e2e/samples.js";

describe("the diagram types", () => {
  it("every type that Mermaid registers has a sample drawn in e2e/mermaid-types.spec.ts", async () => {
    // the types are registered the first time Mermaid is used
    await mermaid.parse("info").catch(() => undefined);
    const registered = mermaid
      .getRegisteredDiagramsMetadata()
      .map((m) => m.id)
      // not types: the error picture, and the detector of unfinished front matter
      .filter((id) => id !== "error" && id !== "---");
    expect(Object.keys(SAMPLES).sort()).toEqual(registered.sort());
    expect(Object.keys(TEMPLATES).sort()).toEqual([...ALLOWED_TYPES].sort());
    // and is either allowed or refused
    expect([...ALLOWED_TYPES, ...REFUSED_TYPES].sort()).toEqual(registered.sort());
  });
});
