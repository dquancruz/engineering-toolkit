import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
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
  });
});
