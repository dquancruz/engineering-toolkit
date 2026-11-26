import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunner, type RegexWorker } from "../src/core/regex-runner.js";
import { evaluate, groupNames, segments, type Evaluation, type RegexRequest } from "../src/core/regex.js";

const ok = (r: Evaluation) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("evaluate", () => {
  it("returns matches with positions and named and numbered groups", () => {
    const r = ok(evaluate({ pattern: "(?<year>\\d{4})-(\\d\\d)?(x)?", flags: "g", text: "a 2026-03 b 1999-" }));
    expect(r.matches).toEqual([
      { start: 2, end: 9, value: "2026-03", groups: [{ number: 1, name: "year", value: "2026" }, { number: 2, value: "03" }, { number: 3 }] },
      { start: 12, end: 17, value: "1999-", groups: [{ number: 1, name: "year", value: "1999" }, { number: 2 }, { number: 3 }] },
    ]);
  });

  it("stops at the first match without g, and honours flags", () => {
    expect(ok(evaluate({ pattern: "a", flags: "", text: "aaa" })).matches).toHaveLength(1);
    expect(ok(evaluate({ pattern: "A", flags: "gi", text: "aA" })).matches).toHaveLength(2);
    expect(ok(evaluate({ pattern: "^b$", flags: "gm", text: "a\nb" })).matches).toHaveLength(1);
    expect(ok(evaluate({ pattern: "a", flags: "y", text: "ba" })).matches).toHaveLength(0);
  });

  it("advances over empty matches, also with Unicode", () => {
    expect(ok(evaluate({ pattern: "", flags: "g", text: "ab" })).matches.map((m) => m.start)).toEqual([0, 1, 2]);
    expect(ok(evaluate({ pattern: "x*", flags: "gu", text: "🚀" })).matches.map((m) => m.start)).toEqual([0, 2]);
  });

  it("measures how long it took", () => {
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1250);
    expect(ok(evaluate({ pattern: "a", flags: "", text: "a" })).elapsedMs).toBe(250);
    now.mockRestore();
  });

  it("limits the number of matches", () => {
    const r = ok(evaluate({ pattern: "a", flags: "g", text: "a".repeat(20) }, 5));
    expect(r).toMatchObject({ truncated: true });
    expect(r.matches).toHaveLength(5);
  });

  it.each([["(", "g"], ["a", "gg"], ["a", "z"]])("reports the invalid pattern %j with flags %j", (pattern, flags) => {
    expect(evaluate({ pattern, flags, text: "" })).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("names groups in order, ignoring classes, escapes and other groups", () => {
    expect(groupNames("\\((?:a)(?=b)(?<!c)(?<=d)[(](?<n>e)(f)")).toEqual(["n", undefined]);
  });

  it("cuts the text into segments, including empty matches", () => {
    const r = ok(evaluate({ pattern: "b*", flags: "g", text: "abbc" }));
    expect(segments("abbc", r.matches)).toEqual([
      { text: "", match: 0 },
      { text: "a" },
      { text: "bb", match: 1 },
      { text: "", match: 2 },
      { text: "c" },
      { text: "", match: 3 },
    ]);
  });
});

describe("createRunner", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  class Fake implements RegexWorker {
    onmessage: RegexWorker["onmessage"] = null;
    onerror: RegexWorker["onerror"] = null;
    terminated = false;
    received: RegexRequest[] = [];
    postMessage(m: RegexRequest) {
      this.received.push(m);
    }
    terminate() {
      this.terminated = true;
    }
    reply() {
      this.onmessage?.({ data: { ok: true, matches: [], truncated: false, elapsedMs: 0 } });
    }
  }
  const setup = () => {
    const spawned: Fake[] = [];
    const runner = createRunner(() => spawned[spawned.push(new Fake()) - 1]!, 100);
    return { spawned, runner };
  };
  const request = { pattern: "a", flags: "g", text: "a" };

  it("reuses a worker that answered", async () => {
    const { spawned, runner } = setup();
    const first = runner.run(request);
    spawned[0]!.reply();
    expect(await first).toMatchObject({ ok: true });
    const second = runner.run(request);
    spawned[0]!.reply();
    await second;
    expect(spawned).toHaveLength(1);
  });

  it("terminates a worker that takes too long, and starts a new one next time", async () => {
    const { spawned, runner } = setup();
    const slow = runner.run(request);
    await vi.advanceTimersByTimeAsync(100);
    expect(await slow).toEqual({ ok: false, timeout: true });
    expect(spawned[0]!.terminated).toBe(true);
    void runner.run(request);
    expect(spawned).toHaveLength(2);
  });

  it("terminates a busy worker when a newer request arrives", async () => {
    const { spawned, runner } = setup();
    const old = runner.run(request);
    const next = runner.run(request);
    expect(await old).toEqual({ ok: false, superseded: true });
    expect(spawned[0]!.terminated).toBe(true);
    spawned[1]!.reply();
    expect(await next).toMatchObject({ ok: true });
  });

  it("reports a worker error", async () => {
    const { spawned, runner } = setup();
    const run = runner.run(request);
    spawned[0]!.onerror?.({ message: "boom" });
    expect(await run).toEqual({ ok: false, failed: "boom" });
  });
});
